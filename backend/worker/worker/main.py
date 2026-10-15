"""Цикл воркера: взяти сегмент → викачати → проходи й події → записати → докази.

Сервіс свідомо тупий і однопотоковий: у прод-стеку йому дано пів ядра й
600 МБ (docker-compose.prod.yml), і паралелізм там не пришвидшить, а лише
зробить памʼять непередбачуваною.

Між сегментами, раз на people_every_s, — дві дрібні роботи: перерахунок
людей і візитів (people.py) і чеки, що доїхали в базу пізніше за свій
сегмент. Коли черга порожня, воркер переробляє старі сегменти новою версією
аналізу (db.claim) і наздоганяє людей по історії — по кроку за раз, щоб
свіжий сегмент ніколи не чекав довше за один крок.
"""
import os
import signal
import tempfile
import time
from datetime import timedelta

from . import config, db, errors, log, people
from . import crops as cr
from . import evidence as evd
from . import pipeline
from .detect import Detector
from .reid import Reid
from .storage import Missing, Storage

_stop = False


def _on_signal(signum, _frame):
    global _stop
    _stop = True
    log.warn("отримано сигнал, дороблюємо поточний сегмент", signal=signum)


def upload(conn, seg, res, written, storage, cfg) -> int:
    """Вирізки проходів і аркуші подій — у extrovert-evidence, ключі — в базу.

    Доказ — приємний бонус, а не причина впасти: подія вже записана, і без
    картинки вона все одно правдива. Тому кожна помилка тут — лише в лог.
    """
    point, base = seg["point_id"], seg["started_at"]
    scene = cfg.scene_for(point, seg["camera_id"])
    n = 0
    for pid, p, _merged, started in written["passages"]:
        if not p.crops:
            continue
        try:
            t0 = (started - base).total_seconds()
            data, parts = cr.strip(p.crops, cfg.crop_max_h, t0)
            key = storage.put_evidence(f"{point}/p/{pid}-{seg['id']}.jpg", data, "image/jpeg")
            db.set_crops(conn, pid, {"key": key, "h": cfg.crop_max_h, "parts": parts})
            n += 1
        except Exception as err:
            log.warn("вирізки не збереглись", passage=pid, err=str(err)[:120])
            errors.capture(err, passage=pid, stage="crops")
    # Доказ — для КОЖНОЇ події, не лише для підходів із чеком (рішення
    # власника 12.10.2026): перевіряти очима треба саме ті події, до яких
    # чек не причепився. Зшита подія аркуш уже має з першого сегмента.
    for event_id, e, stitched in written["events"]:
        if stitched:
            continue
        try:
            key = storage.put_evidence(f"{point}/{event_id}/sheet.jpg",
                                       evd.sheet(e, res, scene, base), "image/jpeg")
            db.set_evidence(conn, event_id, {"sheet": key})
            n += 1
        except Exception as err:
            log.warn("доказ не зберігся", event=event_id, err=str(err)[:120])
            errors.capture(err, event=event_id, stage="evidence")
    return n


def handle(conn, seg, detector, reid, storage, cfg) -> None:
    t0 = time.monotonic()
    scene = cfg.scene_for(seg["point_id"], seg["camera_id"])
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, os.path.basename(seg["r2_key"]))
        size = storage.download(seg["r2_key"], path)
        res = pipeline.process(path, cfg, detector, scene, reid)
    # Файл уже не потрібен: аркуші беруться з кадрів, що пройшли детектор.
    written = db.write_segment(conn, seg, res, cfg)
    files = upload(conn, seg, res, written, storage, cfg)
    s = res.stats
    log.info(
        "сегмент оброблено",
        id=seg["id"], key=seg["r2_key"], mb=round(size / 1e6, 1),
        again=seg.get("analysis_version") or None,
        gated=s.get("gated"), frames=s.get("frames"), passages=s.get("passages"),
        events=len(res.events), receipts=written["receipts"], files=files,
        sec=round(time.monotonic() - t0, 1), reid=round(s.get("reid_s") or 0, 1),
        speed=s.get("speed_x"))


def background(conn, cfg) -> bool:
    """Люди й запізнілі чеки. True — лишилась історія, яку варто наздоганяти далі."""
    behind = False
    try:
        for s in people.run(conn, cfg):
            behind = behind or s["to"] < s["now"] - timedelta(minutes=1)
        n = db.rematch_receipts(conn, cfg)
        if n:
            log.info("чеки наздогнали", receipts=n)
    except Exception as err:
        log.error("люди не перерахувались", err=str(err)[:200])
        errors.capture(err, stage="people")
    return behind


def main() -> None:
    cfg = config.load()
    reporting = errors.init(cfg.app_env)
    if not cfg.database_url:
        raise SystemExit("немає DATABASE_URL")
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    detector = Detector(cfg.model_path, cfg.conf, cfg.nms_iou)
    reid = Reid(cfg.reid_dir, cfg.reid_models)
    if not reid.enabled:
        log.warn("моделей впізнавання немає — проходи без векторів, людей не буде",
                 dir=cfg.reid_dir)
    storage = Storage(cfg)
    conn = db.connect(cfg.database_url)
    log.info("воркер піднявся", env=cfg.app_env, model=cfg.model_path,
             fps=cfg.sample_fps, gate=cfg.motion_gate, reid=",".join(cfg.reid_models) if reid.enabled else None,
             version=config.ANALYSIS_VERSION, reprocess=cfg.reprocess, glitchtip=reporting)

    idle_logged = False
    last_bg = 0.0
    behind = False
    while not _stop:
        if time.monotonic() - last_bg >= cfg.people_every_s:
            behind = background(conn, cfg)
            last_bg = time.monotonic()
        seg = db.claim(conn, cfg)
        if not seg:
            if behind:
                # Черга порожня, а люди по історії ще не пораховані — крок
                # за кроком, без сну.
                behind = background(conn, cfg)
                last_bg = time.monotonic()
                continue
            if not idle_logged:
                q = db.lag(conn)
                log.info("черга порожня", pending=q["pending"], old=q["old"])
                idle_logged = True
            time.sleep(cfg.poll_s)
            continue
        if _stop:
            # Сигнал міг прийти між claim і початком роботи — тоді сегмент
            # чесніше повернути в чергу, ніж підвішувати на 15 хвилин
            # протухання блокування.
            db.release(conn, seg["id"])
            break
        idle_logged = False
        try:
            handle(conn, seg, detector, reid, storage, cfg)
        except Missing:
            # Lifecycle зніс сегмент раніше, ніж ми до нього дійшли. Це не
            # помилка воркера, це відставання — і його видно в алерті про
            # вік найстарішого необробленого сегмента.
            db.finish(conn, seg["id"], "expired", "немає в R2")
            log.warn("сегмент зник із R2", id=seg["id"], key=seg["r2_key"])
        except Exception as err:
            db.finish(conn, seg["id"], "failed", f"{type(err).__name__}: {err}")
            log.error("сегмент впав", id=seg["id"], err=str(err)[:200])
            errors.capture(err, segment=seg["id"], key=seg["r2_key"],
                           attempt=seg.get("attempts"))
        if _stop:
            break

    log.info("зупинка")
    conn.close()


if __name__ == "__main__":
    main()
