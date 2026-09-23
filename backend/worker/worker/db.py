"""Черга й запис подій. Одна таблиця замість брокера — див. docs/video.md.

Чому черга в постгресі, а не в Redis: pub/sub губить повідомлення при
перезапуску підписника, а загублений сегмент — це діра в архіві, якої ніхто
не помітить. `for update skip locked` дає рівно те, що треба, і нічого
доглядати не доводиться.
"""
import json
from datetime import timedelta

import psycopg
from psycopg.rows import dict_row

CLAIM = """
update video_segments s
   set status = 'processing', locked_at = now(), attempts = attempts + 1
 where s.id = (
   select id from video_segments
    where status = 'pending'
       or (status = 'processing' and locked_at < now() - %(stale)s::interval)
       or (status = 'failed' and attempts < %(max_attempts)s)
    order by started_at
    limit 1
    for update skip locked)
returning s.*
"""


def connect(url: str):
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=True)
    return conn


def claim(conn, cfg):
    with conn.cursor() as cur:
        cur.execute(CLAIM, {"stale": f"{cfg.lock_stale_min} minutes",
                            "max_attempts": cfg.max_attempts})
        return cur.fetchone()


def finish(conn, seg_id: int, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update video_segments set status = %s, processed_at = now(), "
            "locked_at = null, error = %s where id = %s",
            (status, (error or None) and error[:500], seg_id))


def release(conn, seg_id: int) -> None:
    """Повернути сегмент у чергу, не витративши спробу: нас просто зупинили."""
    with conn.cursor() as cur:
        cur.execute(
            "update video_segments set status = 'pending', locked_at = null, "
            "attempts = greatest(0, attempts - 1) where id = %s and status = 'processing'",
            (seg_id,))


# ── події ───────────────────────────────────────────────────────────────
# Сегменти ріжуться по 60 с, а людина про це не знає: підхід легко лягає на
# шов. Тому подію, що впирається в край сегмента, ми не вставляємо другою, а
# ДОТЯГУЄМО попередню. Інакше один підхід на 80 секунд у статистиці виглядав
# би як два коротких, і середній час біля стійки поїхав би вниз.
STITCH = """
select id, ended_at, meta from video_events
 where point_id = %(point)s and kind = %(kind)s
   and ended_at between %(from)s and %(to)s
   and coalesce((meta->>'open_end')::boolean, false)
 order by ended_at desc
 limit 1
"""


def write_events(conn, seg, events, cfg) -> list[tuple[int, object]]:
    """Вставляє (або зшиває) події сегмента. Повертає (id, подія)."""
    out = []
    base = seg["started_at"]
    with conn.cursor() as cur:
        for e in events:
            started = base + timedelta(seconds=e.start_s)
            ended = base + timedelta(seconds=e.end_s)
            stitched = None
            if e.open_start:
                cur.execute(STITCH, {
                    "point": seg["point_id"], "kind": e.kind,
                    "from": started - timedelta(seconds=cfg.stitch_gap_s),
                    "to": started + timedelta(seconds=cfg.stitch_gap_s)})
                stitched = cur.fetchone()
            if stitched:
                meta = dict(stitched["meta"] or {})
                meta.update(e.meta)
                meta["open_end"] = e.open_end
                meta["stitched"] = int(meta.get("stitched", 0)) + 1
                meta["dwell_ms"] = int(
                    (ended - stitched["ended_at"]).total_seconds() * 1000
                ) + int(meta.get("dwell_ms", 0))
                cur.execute(
                    "update video_events set ended_at = %s, meta = %s where id = %s",
                    (ended, json.dumps(meta), stitched["id"]))
                out.append((stitched["id"], e))
                continue
            cur.execute(
                "insert into video_events (point_id, kind, started_at, ended_at, "
                "segment_id, meta) values (%s, %s, %s, %s, %s, %s) returning id",
                (seg["point_id"], e.kind, started, ended, seg["id"],
                 json.dumps(e.meta)))
            out.append((cur.fetchone()["id"], e))
    return out


# Чек не «підтверджує» підхід — він лише найкращий збіг за часом, тому й
# колонка зветься likely_receipt_id. Вікно несиметричне: чек друкується на
# початку приготування, тобто за кілька секунд ПІСЛЯ того, як людина
# підійшла, а піти вона може ще хвилину після того, як забрала каву.
#
# Шукаємо від ЧЕКА до підходу, а не навпаки. Перша версія робила навпаки, і
# на першому ж тесті чек забрав собі підхід, що стався за півхвилини до
# нього: кожен підхід брав найближчий вільний чек у своєму вікні, а перевіряв
# їх у порядку вставки. Чек стався один раз і в одну мить — тож питання
# «який підхід його породив» коректне, а зворотне — ні.
RECEIPTS = """
select id, fiscal_date from receipts
 where point_id = %(point)s
   and fiscal_date between %(from)s and %(to)s
   and not exists (select 1 from video_events v
                    where v.likely_receipt_id = receipts.id)
 order by fiscal_date
"""

MATCH = """
update video_events
   set likely_receipt_id = %(receipt)s
 where id = (
   select id from video_events
    where point_id = %(point)s and kind = 'approach'
      and likely_receipt_id is null
      and %(ts)s between started_at - interval '15 seconds'
                     and ended_at + interval '30 seconds'
    order by abs(extract(epoch from (%(ts)s - started_at)) - 10)
    limit 1)
returning id
"""


def match_receipts(conn, seg, duration_s: float) -> set:
    """Роздає чеки сегмента підходам. Повертає id подій, яким чек дістався."""
    matched = set()
    with conn.cursor() as cur:
        cur.execute(RECEIPTS, {
            "point": seg["point_id"],
            "from": seg["started_at"] - timedelta(seconds=30),
            "to": seg["started_at"] + timedelta(seconds=(duration_s or 60) + 15)})
        for receipt in cur.fetchall():
            cur.execute(MATCH, {"receipt": receipt["id"],
                                "point": seg["point_id"],
                                "ts": receipt["fiscal_date"]})
            row = cur.fetchone()
            if row:
                matched.add(row["id"])
    return matched


def set_evidence(conn, event_id: int, evidence: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("update video_events set evidence = %s where id = %s",
                    (json.dumps(evidence), event_id))


def lag(conn) -> dict:
    """Вік найстарішого необробленого сегмента — головний алерт підсистеми."""
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) as pending, "
            "extract(epoch from now() - min(started_at)) as oldest_s "
            "from video_segments where status in ('pending', 'failed')")
        return cur.fetchone()
