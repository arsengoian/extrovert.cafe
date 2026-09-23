"""Звʼязування рамок у треки між кадрами.

Трекер навмисно найпростіший — жадібне зіставлення по IoU. Причина в
семплінгу: між сусідніми кадрами 0,5 с, і людина, що йде зі швидкістю 1,4 м/с,
встигає зміститись на пів метра. Рамки часто вже НЕ перетинаються, тому до
IoU додано відстань між центрами: без неї один підхід розпадався б на три
треки, а з нею — тримається.

Калман, ReID-вектори й інша артилерія тут зайві: нам треба не траєкторія, а
відповідь «це та сама людина, що й пів секунди тому» в межах одного
шістдесятисекундного сегмента.
"""
from dataclasses import dataclass, field


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _centre(b):
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def affinity(a, b) -> float:
    """IoU, а коли рамки розійшлись — близькість центрів у частках розміру."""
    overlap = iou(a, b)
    if overlap > 0:
        return overlap
    (ax, ay), (bx, by) = _centre(a), _centre(b)
    span = max(a[2] - a[0], a[3] - a[1], 1.0)
    dist = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
    return max(0.0, 1.0 - dist / (2.0 * span)) * 0.5


@dataclass
class Track:
    id: int
    box: tuple
    first_t: float
    last_t: float
    conf: float
    seen: int = 1
    # (час, рамка, впевненість) — з цього потім ліпляться події й докази.
    points: list = field(default_factory=list)

    @property
    def dwell_s(self) -> float:
        return self.last_t - self.first_t


class Tracker:
    def __init__(self, max_age_s: float = 1.5, min_score: float = 0.2):
        self.max_age_s = max_age_s
        self.min_score = min_score
        self.alive: list[Track] = []
        self.done: list[Track] = []
        self._next = 1

    def update(self, t: float, boxes) -> list[Track]:
        pairs = []
        for di, det in enumerate(boxes):
            for ti, tr in enumerate(self.alive):
                score = affinity(tr.box, det[:4])
                if score >= self.min_score:
                    pairs.append((score, di, ti))
        pairs.sort(reverse=True)

        used_d, used_t = set(), set()
        for score, di, ti in pairs:
            if di in used_d or ti in used_t:
                continue
            used_d.add(di)
            used_t.add(ti)
            tr, det = self.alive[ti], boxes[di]
            tr.box = tuple(det[:4])
            tr.last_t = t
            tr.conf = max(tr.conf, float(det[4]))
            tr.seen += 1
            tr.points.append((t, tr.box, float(det[4])))

        for di, det in enumerate(boxes):
            if di in used_d:
                continue
            tr = Track(self._next, tuple(det[:4]), t, t, float(det[4]))
            tr.points.append((t, tr.box, float(det[4])))
            self._next += 1
            self.alive.append(tr)

        stale = [tr for tr in self.alive if t - tr.last_t > self.max_age_s]
        self.alive = [tr for tr in self.alive if t - tr.last_t <= self.max_age_s]
        self.done.extend(stale)
        return self.alive

    def finish(self) -> list[Track]:
        out = self.done + self.alive
        self.done, self.alive = [], []
        return sorted(out, key=lambda tr: tr.first_t)
