"""Експеримент: чи можна впізнати ту саму людину на повторному проході.

Навіщо: одна людина бере каву й двічі на день, і хотілося б бачити «це той
самий гість», нічого в нього не питаючи. `docs/video.md` стверджує, що з
нашої камери це не вийде — 52 пікселі між зіницями на відстані метра. Тут це
твердження перевіряється на відео, а не на арифметиці.

Два способи, обидва без жодної нової залежності — детектор облич (YuNet) і
розпізнавач (SFace) уже вбудовані в opencv, моделі беруться з opencv_zoo:

  обличчя — вектор SFace, порівняння косинусом (поріг opencv — 0,363);
  одяг    — гістограма HSV по тулубу, порівняння перетином гістограм.

Як міряємо якість, не розмічаючи відео руками. Кожен трек ділиться навпіл:
перша половина кадрів і друга. Це найлегший можливий випадок повторної
зустрічі — та сама людина, те саме світло, різниця в секунди. Далі:

  «свої» пари  — дві половини одного треку (мають бути схожі);
  «чужі» пари  — половини різних треків (мають бути несхожі).

Якщо метод не розділяє навіть це, на «той самий гість через шість годин»
можна не дивитись. Якщо розділяє — це ще не перемога, а лише те, що легкий
випадок узятий.

  python -m tools.reid_lab /samples/*.mp4 --faces /models/yunet.onnx,/models/sface.onnx
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config, frames as fr  # noqa: E402
from worker.detect import Detector  # noqa: E402
from worker.track import Tracker  # noqa: E402

HSV_BINS = (12, 6, 4)


def torso(rgb, box):
    x1, y1, x2, y2 = (int(v) for v in box[:4])
    h = y2 - y1
    if h < 24:
        return None
    # Голову відрізаємо: волосся й обличчя міняють колір від ракурсу сильніше
    # за куртку, і саме вони першими ламають порівняння за кольором.
    crop = rgb[max(0, y1 + int(0.18 * h)):y1 + int(0.60 * h), max(0, x1):x2]
    return crop if crop.size else None


def cloth_signature(crops):
    if not crops:
        return None
    hist = np.zeros(HSV_BINS, dtype=np.float32)
    for crop in crops:
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        hist += cv2.calcHist([hsv], [0, 1, 2], None, list(HSV_BINS),
                             [0, 180, 0, 256, 0, 256])
    total = hist.sum()
    return (hist / total).ravel() if total else None


def cloth_sim(a, b):
    return float(np.minimum(a, b).sum())


def cos_sim(a, b):
    return float(a @ b.T / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def split(items):
    half = len(items) // 2
    return items[:half], items[half:]


def report(name, pos, neg, thr):
    if not pos or not neg:
        print(f"  {name}: даних замало (своїх {len(pos)}, чужих {len(neg)})")
        return
    pos, neg = np.array(pos), np.array(neg)
    # Скільки «своїх» пар лишились би, якби поріг підняли вище за будь-яку
    # чужу пару. Це і є чесна відповідь «скільки людей упізнається без
    # жодного хибного склеювання».
    clean = float((pos > neg.max()).mean())
    print(f"  {name}: свої {pos.mean():.2f} (мін {pos.min():.2f}), "
          f"чужі {neg.mean():.2f} (макс {neg.max():.2f})")
    print(f"     за порогом {thr}: своїх упізнано {(pos >= thr).mean():.0%}, "
          f"чужих склеєно помилково {(neg >= thr).mean():.0%}")
    print(f"     без жодного хибного склеювання впізнається {clean:.0%} повторних проходів")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--fps", type=float, default=2.0)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--min-frames", type=int, default=6)
    ap.add_argument("--faces", default="", help="шляхи yunet.onnx,sface.onnx")
    ap.add_argument("--degrade", type=int, default=0,
                    help="стиснути вирівняне обличчя до N px і назад: "
                         "симуляція того, скільки пікселів дає наша камера")
    args = ap.parse_args()

    cfg = config.load()
    cfg.motion_gate = False
    det = Detector(cfg.model_path, cfg.conf, cfg.nms_iou)

    yunet = sface = None
    if args.faces:
        y_path, s_path = args.faces.split(",")
        yunet = cv2.FaceDetectorYN.create(y_path, "", (320, 320), 0.6, 0.3, 50)
        sface = cv2.FaceRecognizerSF.create(s_path, "")

    for path in args.files:
        print(f"\n══ {os.path.basename(path)}")
        p = fr.probe(path)
        tracker = Tracker(cfg.track_max_age_s, cfg.track_min_score)
        crops, feats, widths = {}, {}, []

        for offset, rgb in fr.sampled(path, p, args.fps, args.width):
            bgr = rgb[:, :, ::-1].copy()
            h, w = rgb.shape[:2]
            boxes = det(rgb)
            if len(boxes):
                boxes = boxes[(boxes[:, 3] - boxes[:, 1]) >= cfg.min_box_h * h]
            alive = tracker.update(offset, boxes)

            found = []
            if yunet is not None:
                yunet.setInputSize((w, h))
                _, faces = yunet.detect(bgr)
                found = [] if faces is None else list(faces)

            for tr in alive:
                if tr.last_t != offset:
                    continue
                crop = torso(rgb, tr.box)
                if crop is not None:
                    crops.setdefault(tr.id, []).append(crop)
                for f in found:
                    fx, fy, fw, fh = f[:4]
                    cx, cy = fx + fw / 2, fy + fh / 2
                    x1, y1, x2, y2 = tr.box
                    # Обличчя належить треку, якщо воно в його рамці й у
                    # верхній третині: інакше чуже обличчя на другому плані
                    # припишеться тому, хто ближче до камери.
                    if x1 <= cx <= x2 and y1 <= cy <= y1 + (y2 - y1) / 3:
                        widths.append(float(fw))
                        aligned = sface.alignCrop(bgr, f)
                        if args.degrade:
                            # Вирівняне обличчя завжди 112x112. Стиснувши його
                            # до N і повернувши назад, дістаємо рівно стільки
                            # інформації, скільки дало б обличчя шириною N px
                            # у кадрі — тобто нашу камеру на потрібній відстані.
                            n = args.degrade
                            aligned = cv2.resize(
                                cv2.resize(aligned, (n, n), interpolation=cv2.INTER_AREA),
                                (112, 112), interpolation=cv2.INTER_LINEAR)
                        feat = sface.feature(aligned)
                        feats.setdefault(tr.id, []).append(feat[0])
                        break

        tracks = [t for t in tracker.finish() if t.seen >= args.min_frames]
        ids = [t.id for t in tracks]
        print(f"треків ≥{args.min_frames} кадрів: {len(ids)} з {len(tracker.done) + len(tracker.alive) or len(crops)}")
        if widths:
            widths = np.array(widths)
            print(f"облич знайдено {len(widths)} у {len(feats)} треках, "
                  f"ширина {widths.min():.0f}–{widths.max():.0f} px "
                  f"(медіана {np.median(widths):.0f})")
        elif yunet is not None:
            print("облич не знайдено взагалі")

        # ── одяг ───────────────────────────────────────────────────────
        halves = {}
        for i in ids:
            a, b = split(crops.get(i, []))
            sa, sb = cloth_signature(a), cloth_signature(b)
            if sa is not None and sb is not None:
                halves[i] = (sa, sb)
        pos = [cloth_sim(*halves[i]) for i in halves]
        neg = [cloth_sim(halves[i][k], halves[j][m])
               for i in halves for j in halves if i < j
               for k in (0, 1) for m in (0, 1)]
        report("одяг", pos, neg, 0.45)

        # ── обличчя ────────────────────────────────────────────────────
        fhalves = {}
        for i in ids:
            a, b = split(feats.get(i, []))
            if len(a) >= 1 and len(b) >= 1:
                fhalves[i] = (np.mean(a, axis=0), np.mean(b, axis=0))
        pos = [cos_sim(*fhalves[i]) for i in fhalves]
        neg = [cos_sim(fhalves[i][k], fhalves[j][m])
               for i in fhalves for j in fhalves if i < j
               for k in (0, 1) for m in (0, 1)]
        report("обличчя", pos, neg, 0.363)


if __name__ == "__main__":
    main()
