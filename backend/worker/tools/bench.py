"""Прогін конвеєра по локальному файлу — без бази, без R2, без черги.

  python -m tools.bench /samples/*.mkv [--point kyiv-01] [--no-gate] [--no-reid]
                                       [--sheets /out]

Друкує те, заради чого й існує: скільки реального часу відео обробляється за
секунду процесорного, скільки мілісекунд бере модель на кадр, скільки —
впізнавання, і які проходи й події вийшли. З --sheets ще й кладе аркуші-
докази подій туди, куди сказано, — подивитись очима, не заливаючи в R2.
"""
import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config, pipeline  # noqa: E402
from worker import evidence as evd  # noqa: E402
from worker.detect import Detector  # noqa: E402
from worker.reid import Reid  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--point", default="kyiv-01", help="чия сцена (scenes.json)")
    ap.add_argument("--camera", default="cam1")
    ap.add_argument("--no-gate", action="store_true")
    ap.add_argument("--no-reid", action="store_true")
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--sheets", help="тека для аркушів-доказів")
    args = ap.parse_args()

    cfg = config.load()
    if args.no_gate:
        cfg.motion_gate = False
    scene = cfg.scene_for(args.point, args.camera)
    det = Detector(cfg.model_path, cfg.conf, cfg.nms_iou, args.threads)
    reid = None if args.no_reid else Reid(cfg.reid_dir, cfg.reid_models)
    print(f"модель: {cfg.model_path}  вхід {det.size}  потоків {args.threads}  "
          f"впізнавання: {'так' if reid and reid.enabled else 'ні'}  сцена {args.point}:{args.camera}")

    for path in args.files:
        res = pipeline.process(path, cfg, det, scene, reid)
        s = res.stats
        print(f"\n── {os.path.basename(path)}  {s['width']}×{s['height']}  "
              f"{s['duration_s']:.1f} с")
        if s.get("gated"):
            print(f"   гейт: руху немає (motion={s['motion']:.4f}), "
                  f"пропущено за {s['gate_s']:.2f} с")
            continue
        print(f"   гейт {s['gate_s']:.2f} с · декод {s['decode_s']:.2f} с · "
              f"модель {s['infer_s']:.2f} с ({s['ms_per_frame']} мс/кадр) · "
              f"впізнавання {s['reid_s']:.2f} с")
        print(f"   кадрів {s['frames']} · рамок {s['detections']} · "
              f"треків {s['tracks']} · проходів {s['passages']}")
        print(f"   разом {s['total_s']:.2f} с → {s['speed_x']}× реального часу")
        for p in res.passages:
            edge = ("<" if p.open_start else " ") + (">" if p.open_end else " ")
            print(f"   {edge} прохід {p.first_t:6.1f}–{p.last_t:6.1f} с  {p.direction:9s} "
                  f"{p.heading or '-':3s} глибина {p.start_depth:.2f}→{p.end_depth:.2f}  "
                  f"вирізок {len(p.crops)}  треки {p.tracks}"
                  f"{'  автомат ' + str(p.machine_runs) if p.machine_runs else ''}")
        for e in res.events:
            meta = " ".join(f"{k}={v}" for k, v in e.meta.items()
                            if k not in ("open_start", "open_end"))
            edge = ("<" if e.open_start else " ") + (">" if e.open_end else " ")
            print(f"   {edge} {e.kind:9s} {e.start_s:6.1f}–{e.end_s:6.1f} с  {meta}")
        if args.sheets:
            os.makedirs(args.sheets, exist_ok=True)
            base = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc)
            stem = os.path.splitext(os.path.basename(path))[0]
            for i, e in enumerate(res.events):
                with open(os.path.join(args.sheets, f"{stem}_{i:02d}_{e.kind}.jpg"), "wb") as fh:
                    fh.write(evd.sheet(e, res, scene, base))


if __name__ == "__main__":
    main()
