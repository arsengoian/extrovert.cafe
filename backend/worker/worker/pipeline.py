"""Обробка одного сегмента: файл на диску → проходи й події. Без бази й без R2.

Виділено окремо навмисно: рівно цю функцію ганяє tools/bench.py на зразках
відео, тож заміри швидкості стосуються того самого коду, що працює в проді.
"""
import io
import time
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from . import crops as cr
from . import events as ev
from . import frames as fr
from . import passages as ps
from .config import Scene
from .track import Tracker


@dataclass
class Result:
    events: list = field(default_factory=list)
    passages: list = field(default_factory=list)
    # Кадри для аркушів-доказів: час → JPEG кадру детектора (лише ті, де
    # хтось був), і його розмір.
    thumbs: dict = field(default_factory=dict)
    size: tuple = (0, 0)
    stats: dict = field(default_factory=dict)


def downscale(full: np.ndarray, f: int) -> np.ndarray:
    """Середнє f×f — те саме, що scale у ffmpeg, лише з уже декодованого кадру.

    Через PIL (Image.reduce, C), а не numpy: reshape + sum по осях на кадрі
    1280×720 брали 96 мс — більше, ніж сама модель (заміри 15.10.2026).
    """
    if f == 1:
        return full
    return np.asarray(Image.fromarray(full).reduce(f))


def jpeg(rgb: np.ndarray, quality: int = 80) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def process(path: str, cfg, detector, scene: Scene | None = None, reid=None) -> Result:
    t0 = time.monotonic()
    p = fr.probe(path)
    scene = scene or Scene()

    motion = None
    if cfg.motion_gate:
        motion = fr.motion_score(path, p, cfg.motion_pixel_delta)
        if motion < cfg.motion_min_fraction:
            # Нічого не ворухнулось — отже, ні підходів, ні перехожих: подій
            # немає, і сегмент просто позначається обробленим. Саме так гейт
            # економить 90 % кадрів.
            gate_s = time.monotonic() - t0
            return Result(stats={
                "gated": True, "motion": motion, "frames": 0,
                "duration_s": p.duration_s, "gate_s": gate_s,
                "total_s": gate_s, "width": p.width, "height": p.height})
    gate_s = time.monotonic() - t0

    # Декодуємо вдвічі ширше, ніж бачить модель: вирізки людей — з повного
    # кадру. Джерело вужче за crop_width (старі сегменти) — модель бачить
    # кадр як є, вирізки з нього ж.
    full_w = min(cfg.crop_width, p.width)
    f = max(1, full_w // cfg.decode_width)
    tracker = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    keeper = None
    times, thumbs, dets_total, infer_s = [], {}, 0, 0.0
    w = h = 0

    t1 = time.monotonic()
    for offset, full in fr.sampled(path, p, cfg.sample_fps, full_w):
        rgb = downscale(full, f)
        h, w = rgb.shape[:2]
        if keeper is None:
            keeper = cr.Keeper(w, h, f, cfg.crop_max_h)
        ti = time.monotonic()
        boxes = detector(rgb)
        infer_s += time.monotonic() - ti
        if len(boxes):
            keep = (boxes[:, 3] - boxes[:, 1]) >= cfg.min_box_h * h
            boxes = boxes[keep]
        dets_total += len(boxes)
        alive = tracker.update(offset, boxes)
        keeper.see(offset, full, alive)
        if len(boxes):
            thumbs[round(offset, 2)] = jpeg(rgb)
        times.append(offset)
    decode_s = time.monotonic() - t1 - infer_s

    tracks = tracker.finish()
    t2 = time.monotonic()
    cand = {tr.id: keeper.take(tr.id) for tr in tracks} if keeper else {}
    found_ps = ps.build(tracks, cand, reid, scene, cfg, w or p.width, h or p.height, times)
    reid_s = time.monotonic() - t2
    found = ev.derive(found_ps, times, cfg, p.duration_s or (times[-1] if times else 0.0))
    total = time.monotonic() - t0
    return Result(found, found_ps, thumbs, (w, h), {
        "gated": False, "motion": motion, "frames": len(times),
        "tracks": len(tracks), "passages": len(found_ps), "detections": dets_total,
        "duration_s": p.duration_s, "width": p.width, "height": p.height,
        "gate_s": gate_s, "decode_s": decode_s, "infer_s": infer_s, "reid_s": reid_s,
        "ms_per_frame": round(1000 * infer_s / max(1, len(times)), 1),
        "total_s": total,
        "speed_x": round((p.duration_s or 0) / total, 1) if total else None,
    })
