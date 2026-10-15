"""Черга, запис проходів і подій, звʼязок із чеками. Одна таблиця замість брокера — див. docs/video.md.

Чому черга в постгресі, а не в Redis: pub/sub губить повідомлення при
перезапуску підписника, а загублений сегмент — це діра в архіві, якої ніхто
не помітить. `for update skip locked` дає рівно те, що треба, і нічого
доглядати не доводиться.

Усе, що воркер пише про сегмент, іде однією транзакцією разом зі статусом
done: впав посередині — сегмент лишився «processing», через 15 хв його
підбере знову, і половинок не буде. Докази (аркуші, вирізки) вантажаться
вже після коміту: без них подія все одно правдива.
"""
import json
from datetime import timedelta

import psycopg
from psycopg.rows import dict_row

from . import passages as ps
from . import scene as sc
from .config import ANALYSIS_VERSION

# Запис малини — першим: архів картки (source 'sd') доливається пачкою на
# сотні сегментів, і без цього свіжі хвилини чекали б, поки він пройде.
# Усередині кожного джерела — за часом: проходи дошиваються до попереднього
# сегмента (write_passages).
CLAIM = """
update video_segments s
   set status = 'processing', locked_at = now(), attempts = attempts + 1
 where s.id = (
   select id from video_segments
    where status = 'pending'
       or (status = 'processing' and locked_at < now() - %(stale)s::interval)
       or (status = 'failed' and attempts < %(max_attempts)s)
    order by source = 'sd', started_at
    limit 1
    for update skip locked)
returning s.*
"""

# Переаналіз: коли свіжих сегментів немає, воркер бере найстаріший,
# оброблений меншою версією аналізу. Саме найстаріший — проходи дошиваються
# до проходів попереднього сегмента (write_passages), тож іти треба в тому
# ж порядку, в якому їх писала камера. attempts скидаємо: це нова робота, а
# не повтор старої.
CLAIM_OLD = """
update video_segments s
   set status = 'processing', locked_at = now(), attempts = 1
 where s.id = (
   select id from video_segments
    where status = 'done' and analysis_version < %(version)s
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
        row = cur.fetchone()
        if row or not cfg.reprocess:
            return row
        cur.execute(CLAIM_OLD, {"version": ANALYSIS_VERSION})
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


# ── сегмент цілком ──────────────────────────────────────────────────────
def write_segment(conn, seg, res, cfg) -> dict:
    """Проходи, події й чеки сегмента — одна транзакція разом зі статусом done.

    Повертає {"events": [(id, подія, зшита?)],
              "passages": [(id, прохід, дошитий?, початок проходу в базі)]}.
    """
    scene = cfg.scene_for(seg["point_id"], seg["camera_id"])
    with conn.transaction(), conn.cursor() as cur:
        supersede(cur, seg["id"])
        pids = write_passages(cur, seg, res.passages, scene, cfg)
        written = write_events(cur, seg, res.events, pids, cfg)
        n = attribute_receipts(cur, seg["point_id"], seg["started_at"] - timedelta(seconds=30),
                               seg["started_at"] + timedelta(seconds=(res.stats.get("duration_s") or 60) + 15),
                               cfg)
        duration = res.stats.get("duration_s")
        cur.execute(
            "update video_segments set status = 'done', processed_at = now(), locked_at = null, "
            "error = null, analysis_version = %s, duration_ms = coalesce(%s, duration_ms) where id = %s",
            (ANALYSIS_VERSION, int(duration * 1000) if duration else None, seg["id"]))
    return {"events": written, "passages": pids, "receipts": n}


def supersede(cur, seg_id: int) -> None:
    """Переаналіз: старі події сегмента — заміненими, старі проходи — геть.

    Події не видаляємо: на них може посилатись redemptions.evidence_event_id,
    і доказ, яким колись підтвердили бонус, мусить лишитись. Проходи ніхто
    ззовні не посилається, тож їх простіше переписати.
    """
    cur.execute("update video_events set superseded_at = now() "
                "where segment_id = %s and superseded_at is null", (seg_id,))
    cur.execute("delete from video_passages where segment_id = %s", (seg_id,))


# ── проходи ─────────────────────────────────────────────────────────────
# Сегменти ріжуться по 60 с, а людина про це не знає: прохід легко лягає на
# шов. Прохід, що впирається в початок сегмента, дошиваємо до проходу
# попереднього сегмента, що впирається в кінець, — якщо той закінчився там
# само й людина не надто несхожа (ті самі пороги, що й шов треків усередині
# сегмента, passages.join).
OPEN_BEFORE = """
select id, started_at, ended_at, points, crops, embedding, emb_weight, frames,
       at_zone, at_machine, open_start
  from video_passages
 where point_id = %(point)s and camera_id = %(camera)s and open_end
   and ended_at between %(from)s and %(to)s
"""


def _pt(points: list, base, start) -> list:
    """Стиснуті точки з бази → [t від start у с, x1, y1, x2, y2, 1]."""
    off = (base - start).total_seconds()
    return [[off + q[0] / 1000, q[1], q[2], q[3], q[4], 1.0] for q in points]


def write_passages(cur, seg, passages, scene, cfg) -> list:
    base = seg["started_at"]
    step = 1.0 / cfg.sample_fps
    out = []
    used = set()
    for p in passages:
        started = base + timedelta(seconds=p.first_t)
        ended = base + timedelta(seconds=p.last_t + step)
        prev = None
        if p.open_start:
            cur.execute(OPEN_BEFORE, {
                "point": seg["point_id"], "camera": seg["camera_id"],
                "from": started - timedelta(seconds=cfg.join_gap_s + step),
                "to": started + timedelta(seconds=step)})
            best = None
            for row in cur.fetchall():
                if row["id"] in used or not row["points"]:
                    continue
                last = _pt(row["points"][-1:], row["started_at"], base)[0]
                (ax, ay), (bx, by) = ps._foot(last), ps._foot(p.points[0])
                if ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 > cfg.join_dist:
                    continue
                s = 0.5
                if row["embedding"] is not None and p.emb is not None:
                    s = float(sum(a * b for a, b in zip(row["embedding"], p.emb.tolist())))
                if s >= cfg.join_sim and (best is None or s > best[0]):
                    best = (s, row)
            prev = best[1] if best else None
        if prev is not None:
            used.add(prev["id"])
            out.append((_extend(cur, seg, prev, p, scene, cfg), p, True, prev["started_at"]))
            continue
        cur.execute(
            "insert into video_passages (point_id, camera_id, segment_id, analysis_version, "
            "started_at, ended_at, direction, heading, frames, start_depth, end_depth, "
            "min_depth, max_depth, at_zone, at_machine, open_start, open_end, points, "
            "embedding, emb_weight) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            "%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (seg["point_id"], seg["camera_id"], seg["id"], ANALYSIS_VERSION, started, ended,
             p.direction, p.heading, len(p.points), p.start_depth, p.end_depth,
             p.min_depth, p.max_depth, _at_zone(p, cfg), bool(p.machine_runs),
             p.open_start, p.open_end, json.dumps(ps.compact(p.points, p.first_t)),
             # Вектор з однієї вирізки — шум (аналіз архіву: MIN_CROPS = 2),
             # такий прохід у впізнавання не йде.
             p.emb.tolist() if p.emb is not None and len(p.crops) >= cfg.min_crops else None,
             p.emb_w))
        out.append((cur.fetchone()["id"], p, False, started))
    return out


def _at_zone(p, cfg) -> bool:
    step = 1.0 / cfg.sample_fps
    return any(b - a + step >= cfg.approach_min_s for a, b in p.zone_runs)


def _extend(cur, seg, prev, p, scene, cfg) -> int:
    """Дошити прохід сегмента до проходу попереднього сегмента."""
    from . import reid as rd
    base = seg["started_at"]
    step = 1.0 / cfg.sample_fps
    start = prev["started_at"]
    off = (base - start).total_seconds()
    pts = _pt(prev["points"], start, start) + [[q[0] + off] + q[1:] for q in p.points]
    d = sc.direction(pts, cfg.move_depth)
    emb, w = rd.merge(prev["embedding"], prev["emb_weight"] or 0.0,
                      p.emb, p.emb_w)
    cur.execute(
        "update video_passages set ended_at = %s, direction = %s, heading = %s, frames = %s, "
        "start_depth = %s, end_depth = %s, min_depth = %s, max_depth = %s, "
        "at_zone = at_zone or %s, at_machine = at_machine or %s, open_end = %s, points = %s, "
        "embedding = %s, emb_weight = %s where id = %s",
        (base + timedelta(seconds=p.last_t + step), d["direction"], scene.heading_of(d["direction"]),
         len(pts), d["start_depth"], d["end_depth"], d["min_depth"], d["max_depth"],
         _at_zone(p, cfg), bool(p.machine_runs), p.open_end,
         json.dumps(ps.compact(pts, 0.0)),
         emb.tolist() if emb is not None else None, w, prev["id"]))
    return prev["id"]


def set_crops(conn, passage_id: int, entry: dict) -> None:
    """Дописати смужку вирізок (ключ у R2 і розмітку) до проходу."""
    with conn.cursor() as cur:
        cur.execute("update video_passages set crops = crops || %s::jsonb where id = %s",
                    (json.dumps([entry]), passage_id))


# ── події ───────────────────────────────────────────────────────────────
# Подію, що впирається в початок сегмента, не вставляємо другою, а
# ДОТЯГУЄМО попередню: інакше один підхід на 80 секунд у статистиці
# виглядав би як два коротких, і середній час біля стійки поїхав би вниз.
# Подія людини дошивається до події того самого проходу (його вже дошив
# write_passages), черга — за часом.
STITCH_PASSAGE = """
select id, ended_at, meta from video_events
 where passage_id = %(passage)s and kind = %(kind)s and superseded_at is null
   and coalesce((meta->>'open_end')::boolean, false)
 order by ended_at desc
 limit 1
"""

STITCH_TIME = """
select id, ended_at, meta from video_events
 where point_id = %(point)s and kind = %(kind)s and superseded_at is null
   and analysis_version = %(version)s
   and ended_at between %(from)s and %(to)s
   and coalesce((meta->>'open_end')::boolean, false)
 order by ended_at desc
 limit 1
"""


def write_events(cur, seg, events, pids, cfg) -> list[tuple[int, object, bool]]:
    """Вставляє (або зшиває) події сегмента. Повертає (id, подія, зшита?)."""
    out = []
    base = seg["started_at"]
    pid_of = {id(p): (pid, merged) for pid, p, merged, _ in pids}
    for e in events:
        started = base + timedelta(seconds=e.start_s)
        ended = base + timedelta(seconds=e.end_s)
        pid, merged = pid_of.get(id(e.passage), (None, False))
        if merged and e.kind in ("pass", "approach") and _one_per_passage(cur, pid, e.kind):
            continue
        stitched = None
        if e.open_start and e.passage is not None and merged:
            cur.execute(STITCH_PASSAGE, {"passage": pid, "kind": e.kind})
            stitched = cur.fetchone()
        elif e.open_start and e.passage is None:
            cur.execute(STITCH_TIME, {
                "point": seg["point_id"], "kind": e.kind, "version": ANALYSIS_VERSION,
                "from": started - timedelta(seconds=cfg.stitch_gap_s),
                "to": started + timedelta(seconds=cfg.stitch_gap_s)})
            stitched = cur.fetchone()
        if stitched:
            meta = dict(stitched["meta"] or {})
            meta.update({k: v for k, v in e.meta.items() if k not in ("dwell_ms", "frames")})
            meta["open_end"] = e.open_end
            meta["stitched"] = int(meta.get("stitched", 0)) + 1
            meta["frames"] = int(meta.get("frames", 0)) + int(e.meta.get("frames", 0))
            meta["dwell_ms"] = int(
                (ended - stitched["ended_at"]).total_seconds() * 1000
            ) + int(meta.get("dwell_ms", 0))
            cur.execute(
                "update video_events set ended_at = %s, meta = %s where id = %s",
                (ended, json.dumps(meta), stitched["id"]))
            out.append((stitched["id"], e, True))
            continue
        cur.execute(
            "insert into video_events (point_id, camera_id, kind, started_at, ended_at, "
            "segment_id, passage_id, analysis_version, meta) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (seg["point_id"], seg["camera_id"], e.kind, started, ended, seg["id"], pid,
             ANALYSIS_VERSION, json.dumps(e.meta)))
        out.append((cur.fetchone()["id"], e, False))
    return out


def _one_per_passage(cur, pid: int, kind: str) -> bool:
    """Прохід — або approach, або pass. True — подію цього виду писати не треба.

    Людина підійшла в одному сегменті, а пішла коридором уже в наступному:
    шматок проходу в наступному сегменті сам по собі — «пройшов повз», але
    прохід цілком — підхід. Тож pass до проходу з підходом не пишемо, а
    pass, що вже є, коли в продовженні знайшовся підхід, — замінюємо.
    """
    cur.execute("select kind from video_events where passage_id = %s and superseded_at is null "
                "and kind in ('approach', 'pass')", (pid,))
    have = {r["kind"] for r in cur.fetchall()}
    if kind == "pass":
        return "approach" in have
    if "pass" in have:
        cur.execute("update video_events set superseded_at = now() where passage_id = %s "
                    "and kind = 'pass' and superseded_at is null", (pid,))
    return False


def set_evidence(conn, event_id: int, evidence: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("update video_events set evidence = coalesce(evidence, '{}'::jsonb) || %s "
                    "where id = %s", (json.dumps(evidence), event_id))


# ── чеки ────────────────────────────────────────────────────────────────
# Чек — одна мить (fiscal_date), і питання «хто стояв біля автомата в цю
# мить» коректне, а «який чек дістався підходу» — ні: перша версія роздавала
# чеки підходам за часовим вікном і на архіві картки 09–14.10 вгадала 3 з 4
# покупців (раз — сусіда, що стояв поруч довше). Тепер покупець — прохід,
# рамка якого в мить оплати (±PAY_TOL) стоїть там, де стоять біля самого
# автомата (scene.machine); немає такого — будь-хто в зоні біля кавʼярні.
# Один такий — 'alone'; кілька — 'ambiguous', і чек дістається тому, хто
# простояв там найдовше. Сусід на стільці поруч (10.10 22:47, чек 980) у
# зоні стоїть, а біля автомата — ні, тож покупцем уже не стає. Чек переходить
# і на подію approach (або machine) цього проходу — likely_receipt_id.
PAY_TOL = 2.6

RECEIPTS = """
select r.id, r.fiscal_date from receipts r
 where r.point_id = %(point)s
   and r.fiscal_date between %(from)s and %(to)s
   and not exists (select 1 from video_passages p where p.receipt_id = r.id)
 order by r.fiscal_date
"""

AROUND = """
select id, camera_id, started_at, points from video_passages
 where point_id = %(point)s and receipt_id is null
   and started_at <= %(ts)s + interval '3 seconds'
   and ended_at >= %(ts)s - interval '3 seconds'
"""


def attribute_receipts(cur, point: str, t_from, t_to, cfg) -> int:
    cur.execute(RECEIPTS, {"point": point, "from": t_from, "to": t_to})
    n = 0
    for r in cur.fetchall():
        ts = r["fiscal_date"]
        cur.execute(AROUND, {"point": point, "ts": ts})
        at_machine, in_zone = [], []
        for row in cur.fetchall():
            scene = cfg.scene_for(point, row["camera_id"])
            pts = _pt(row["points"], row["started_at"], ts)
            near = [q for q in pts if abs(q[0]) <= PAY_TOL]
            if any(sc.at_machine(q, scene.machine) for q in near):
                at_machine.append((sum(1 for q in pts if sc.at_machine(q, scene.machine)), row["id"]))
            if any(ps.in_zone(q, scene.zone) for q in near):
                in_zone.append((sum(1 for q in pts if ps.in_zone(q, scene.zone)), row["id"]))
        cands = at_machine or in_zone
        if not cands:
            continue
        _, pid = max(cands)
        match = "alone" if len(cands) == 1 else "ambiguous"
        cur.execute("update video_passages set receipt_id = %s, receipt_match = %s where id = %s",
                    (r["id"], match, pid))
        cur.execute(
            "update video_events set likely_receipt_id = %(r)s where id = ("
            " select id from video_events where passage_id = %(p)s and superseded_at is null"
            "    and kind in ('approach', 'machine') and likely_receipt_id is null"
            "  order by kind = 'approach' desc,"
            "           abs(extract(epoch from (%(ts)s - started_at))) limit 1)",
            {"r": r["id"], "p": pid, "ts": ts})
        n += 1
    return n


def rematch_receipts(conn, cfg, hours: float = 6.0) -> int:
    """Чеки, що прийшли в базу пізніше за свій сегмент (Checkbox poll), — наздогнати."""
    n = 0
    with conn.cursor() as cur:
        cur.execute("select now() - %s * interval '1 hour' as a, now() as b", (hours,))
        t = cur.fetchone()
        cur.execute("select distinct point_id from receipts where fiscal_date between %s and %s",
                    (t["a"], t["b"]))
        points = [r["point_id"] for r in cur.fetchall()]
    for point in points:
        with conn.transaction(), conn.cursor() as cur:
            n += attribute_receipts(cur, point, t["a"], t["b"], cfg)
    return n


def lag(conn) -> dict:
    """Вік найстарішого необробленого сегмента — головний алерт підсистеми."""
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) as pending, "
            "extract(epoch from now() - min(started_at)) as oldest_s, "
            "(select count(*) from video_segments where status = 'done' "
            "   and analysis_version < %s) as old "
            "from video_segments where status in ('pending', 'failed')",
            (ANALYSIS_VERSION,))
        return cur.fetchone()
