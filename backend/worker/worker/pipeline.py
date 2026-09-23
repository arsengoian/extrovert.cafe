"""Обробка одного сегмента: файл на диску → події. Без бази й без R2.

Виділено окремо навмисно: рівно цю функцію ганяє tools/bench.py на зразках
відео, тож заміри швидкості стосуються того самого коду, що працює в проді.
"""
import time
from dataclasses import dataclass, field

from . import events as ev
from . import frames as fr
from .config import DEFAULT_ZONE
from .track import Tracker


@dataclass
class Result:
    events: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def process(path: str, cfg, detector, zone=None) -> Result:
    t0 = time.monotonic()
    p = fr.probe(path)
    if zone is None:
        zone = DEFAULT_ZONE

    motion = None
    if cfg.motion_gate:
        motion = fr.motion_score(path, p, cfg.motion_pixel_delta)
        if motion < cfg.motion_min_fraction:
            # Нічого не ворухнулось — але це не «немає даних», це idle.
            # Саме так гейт економить 90 % кадрів і не робить дірку в добі.
            gate_s = time.monotonic() - t0
            return Result(
                [ev.Event("idle", 0.0, p.duration_s,
                          {"gated": True, "motion": round(motion, 5),
                           "open_start": True, "open_end": True}, True, True)],
                {"gated": True, "motion": motion, "frames": 0,
                 "duration_s": p.duration_s, "gate_s": gate_s,
                 "total_s": gate_s, "width": p.width, "height": p.height},
            )
    gate_s = time.monotonic() - t0

    tracker = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times, dets_total, infer_s = [], 0, 0.0
    w = h = 0

    t1 = time.monotonic()
    for offset, rgb in fr.sampled(path, p, cfg.sample_fps, cfg.decode_width):
        h, w = rgb.shape[:2]
        ti = time.monotonic()
        boxes = detector(rgb)
        infer_s += time.monotonic() - ti
        if len(boxes):
            keep = (boxes[:, 3] - boxes[:, 1]) >= cfg.min_box_h * h
            boxes = boxes[keep]
        dets_total += len(boxes)
        tracker.update(offset, boxes)
        times.append(offset)
    decode_s = time.monotonic() - t1 - infer_s

    tracks = tracker.finish()
    found = ev.derive(tracks, times, zone, w or p.width, h or p.height, cfg,
                      p.duration_s or (times[-1] if times else 0.0))
    total = time.monotonic() - t0
    return Result(found, {
        "gated": False, "motion": motion, "frames": len(times),
        "tracks": len(tracks), "detections": dets_total,
        "duration_s": p.duration_s, "width": p.width, "height": p.height,
        "gate_s": gate_s, "decode_s": decode_s, "infer_s": infer_s,
        "ms_per_frame": round(1000 * infer_s / max(1, len(times)), 1),
        "total_s": total,
        "speed_x": round((p.duration_s or 0) / total, 1) if total else None,
    })
