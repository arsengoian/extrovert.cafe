"""Прогін конвеєра по локальному файлу — без бази, без R2, без черги.

  python -m tools.bench /samples/*.mp4 [--zone 0.1,0.4,0.9,1.0] [--no-gate]

Друкує те, заради чого й існує: скільки реального часу відео обробляється за
секунду процесорного, скільки мілісекунд бере модель на кадр і які події
вийшли. Числа з docs/video.md («~80 мс на кадр», «4,6× до реального часу»)
брались зі стелі — цей скрипт дає свої.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config, pipeline  # noqa: E402
from worker.detect import Detector  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--zone", help="x1,y1,x2,y2 у частках кадру (прямокутник)")
    ap.add_argument("--no-gate", action="store_true")
    ap.add_argument("--threads", type=int, default=1)
    args = ap.parse_args()

    cfg = config.load()
    if args.no_gate:
        cfg.motion_gate = False
    zone = None
    if args.zone:
        x1, y1, x2, y2 = (float(v) for v in args.zone.split(","))
        zone = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]

    det = Detector(cfg.model_path, cfg.conf, cfg.nms_iou, args.threads)
    print(f"модель: {cfg.model_path}  вхід {det.size}  потоків {args.threads}")

    for path in args.files:
        res = pipeline.process(path, cfg, det, zone)
        s = res.stats
        print(f"\n── {os.path.basename(path)}  {s['width']}×{s['height']}  "
              f"{s['duration_s']:.1f} с")
        if s.get("gated"):
            print(f"   гейт: руху немає (motion={s['motion']:.4f}), "
                  f"пропущено за {s['gate_s']:.2f} с")
        else:
            print(f"   гейт {s['gate_s']:.2f} с · декод {s['decode_s']:.2f} с · "
                  f"модель {s['infer_s']:.2f} с ({s['ms_per_frame']} мс/кадр)")
            print(f"   кадрів {s['frames']} · рамок {s['detections']} · "
                  f"треків {s['tracks']}")
            print(f"   разом {s['total_s']:.2f} с → {s['speed_x']}× реального часу")
        for e in res.events:
            meta = " ".join(f"{k}={v}" for k, v in e.meta.items()
                            if k not in ("open_start", "open_end"))
            edge = ("<" if e.open_start else " ") + (">" if e.open_end else " ")
            print(f"   {edge} {e.kind:9s} {e.start_s:6.1f}–{e.end_s:6.1f} с  {meta}")


if __name__ == "__main__":
    main()
