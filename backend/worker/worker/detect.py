"""Детекція людей: YOLO-n в ONNX Runtime, один клас із вісімдесяти.

Чому ONNX, а не ultralytics: на дроплеті 2 ГБ памʼяті, а torch із залежностями
важить більше за весь інший стек воркера. Модель конвертується один раз на
збірці (docker/Dockerfile), тут лишається лише рантайм на кількасот мегабайт.
"""
import numpy as np
import onnxruntime as ort

PERSON = 0  # клас 0 у COCO


def letterbox(img: np.ndarray, size: int = 640) -> tuple[np.ndarray, float, int, int]:
    """Вписати кадр у квадрат моделі, не спотворивши пропорції."""
    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    out = np.full((size, size, 3), 114, dtype=np.uint8)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    # Крок-ресайз без cv2: беремо найближчий піксель. На вході 640 і моделі
    # 640 різниця з білінійним інтерполюванням у межах шуму, зате не тягнемо
    # opencv у гарячий цикл.
    ys = (np.arange(nh) / scale).astype(np.int32).clip(0, h - 1)
    xs = (np.arange(nw) / scale).astype(np.int32).clip(0, w - 1)
    out[dy:dy + nh, dx:dx + nw] = img[ys][:, xs]
    return out, scale, dx, dy


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / (area_i + area_r - inter + 1e-9)
        order = rest[iou < iou_thr]
    return keep


class Detector:
    def __init__(self, model_path: str, conf: float = 0.35, iou: float = 0.45, threads: int = 1):
        opts = ort.SessionOptions()
        # На shared vCPU пул потоків більший за одиницю тільки заважає:
        # ядро одне, а перемикання контексту реальне.
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        self.input = self.sess.get_inputs()[0].name
        self.size = self.sess.get_inputs()[0].shape[2] or 640
        self.conf = conf
        self.iou = iou

    def __call__(self, rgb: np.ndarray) -> np.ndarray:
        """Повертає масив (N, 5): x1, y1, x2, y2, conf у пікселях кадру."""
        img, scale, dx, dy = letterbox(rgb, self.size)
        blob = img.transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        out = self.sess.run(None, {self.input: blob})[0]

        # YOLOv8/11 віддають (1, 4+класи, N) — транспонуємо в (N, 4+класи).
        pred = out[0].T if out.shape[1] < out.shape[2] else out[0]
        scores = pred[:, 4 + PERSON]
        pred = pred[scores >= self.conf]
        scores = scores[scores >= self.conf]
        if not len(pred):
            return np.zeros((0, 5), dtype=np.float32)

        cx, cy, w, h = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
        boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
        keep = nms(boxes, scores, self.iou)
        boxes, scores = boxes[keep], scores[keep]

        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - dx) / scale
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - dy) / scale
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, rgb.shape[1])
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, rgb.shape[0])
        return np.concatenate([boxes, scores[:, None]], axis=1).astype(np.float32)
