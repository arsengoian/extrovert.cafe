"""Цикл воркера: взяти сегмент → викачати → продетектити → записати → done.

Сервіс свідомо тупий і однопотоковий. На дроплеті analysis одне ядро, і
паралелізм там не пришвидшить, а лише зробить памʼять непередбачуваною —
а саме через непередбачувану памʼять цей воркер і живе окремо від api
(docs/video.md, «Чому два дроплети»).
"""
import os
import signal
import tempfile
import time

from . import config, db, log
from . import frames as fr
from . import pipeline
from .detect import Detector
from .storage import Missing, Storage

_stop = False


def _on_signal(signum, _frame):
    global _stop
    _stop = True
    log.warn("отримано сигнал, дороблюємо поточний сегмент", signal=signum)


def evidence_for(conn, path: str, seg, event_id: int, e, storage, cfg) -> None:
    """Кадр (і за потреби кліп) у extrovert-evidence, ключі — в подію."""
    if e.best is None:
        return
    at, _box = e.best
    keys = {}
    try:
        keys["frame_00"] = storage.put_evidence(
            f"{seg['point_id']}/{event_id}/frame_00.jpg",
            fr.still(path, at), "image/jpeg")
        if cfg.evidence_clips:
            with tempfile.TemporaryDirectory() as tmp:
                dst = os.path.join(tmp, "clip.mp4")
                fr.clip(path, dst, max(0.0, e.start_s - 2), e.end_s - e.start_s + 4)
                with open(dst, "rb") as fh:
                    keys["clip"] = storage.put_evidence(
                        f"{seg['point_id']}/{event_id}/clip.mp4",
                        fh.read(), "video/mp4")
    except Exception as err:  # доказ — приємний бонус, а не причина впасти
        log.warn("доказ не зберігся", event=event_id, err=str(err)[:120])
        if not keys:
            return
    db.set_evidence(conn, event_id, keys)


def handle(conn, seg, detector, storage, cfg) -> None:
    t0 = time.monotonic()
    zone = cfg.zone_for(seg["point_id"], seg["camera_id"])
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, os.path.basename(seg["r2_key"]))
        size = storage.download(seg["r2_key"], path)
        res = pipeline.process(path, cfg, detector, zone)

        written = db.write_events(conn, seg, res.events, cfg)
        # Доказ зберігаємо лише для підходів із чеком: це те, що показує
        # адмінка в замовленнях, і одночасно єдині кадри, які точно варті
        # місця. Складати картинку кожного перехожого — це персональні дані,
        # яких ми не просили.
        matched = db.match_receipts(conn, seg, res.stats.get("duration_s") or 0)
        for event_id, e in written:
            if event_id in matched:
                evidence_for(conn, path, seg, event_id, e, storage, cfg)

    db.finish(conn, seg["id"], "done")
    s = res.stats
    log.info(
        "сегмент оброблено",
        id=seg["id"], key=seg["r2_key"], mb=round(size / 1e6, 1),
        gated=s.get("gated"), frames=s.get("frames"),
        events=len(res.events), receipts=len(matched),
        sec=round(time.monotonic() - t0, 1), speed=s.get("speed_x"))


def main() -> None:
    cfg = config.load()
    if not cfg.database_url:
        raise SystemExit("немає DATABASE_URL")
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    detector = Detector(cfg.model_path, cfg.conf, cfg.nms_iou)
    storage = Storage(cfg)
    conn = db.connect(cfg.database_url)
    log.info("воркер піднявся", env=cfg.app_env, model=cfg.model_path,
             fps=cfg.sample_fps, gate=cfg.motion_gate)

    idle_logged = False
    while not _stop:
        seg = db.claim(conn, cfg)
        if not seg:
            if not idle_logged:
                q = db.lag(conn)
                log.info("черга порожня", pending=q["pending"])
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
            handle(conn, seg, detector, storage, cfg)
        except Missing:
            # Lifecycle зніс сегмент раніше, ніж ми до нього дійшли. Це не
            # помилка воркера, це відставання — і його видно в алерті про
            # вік найстарішого необробленого сегмента.
            db.finish(conn, seg["id"], "expired", "немає в R2")
            log.warn("сегмент зник із R2", id=seg["id"], key=seg["r2_key"])
        except Exception as err:
            db.finish(conn, seg["id"], "failed", f"{type(err).__name__}: {err}")
            log.error("сегмент впав", id=seg["id"], err=str(err)[:200])
        if _stop:
            break

    log.info("зупинка")
    conn.close()


if __name__ == "__main__":
    main()
