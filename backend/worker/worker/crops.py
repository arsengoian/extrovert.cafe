"""Вирізки людей із повного кадру, поки трек живий.

Детектор бачить кадр 640 у ширину, а вирізки беруться з кадру вдвічі
більшого (config.crop_width): для впізнавання за одягом пікселі потрібні —
на 640 людина в глибині коридору виходить на 40 пікселів заввишки.

Під час проходу кандидатів ще не відкидаємо: потрібні вирізки з усієї
траєкторії, і спиною (заходить у зал), і обличчям (виходить), бо саме вони
потім зводять вхід із виходом. Коли кандидатів забагато, проріджуємо
рівномірно через один, а не викидаємо найгірші.
"""
import io

from PIL import Image

CAND_MAX = 24


def overlap(a, b) -> float:
    """Частка рамки a, яку закриває рамка b."""
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    return inter / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))


def crop_of(full, box, f: int, max_h: int):
    """Рамка в пікселях кадру детектора → вирізка з повного кадру, з полями."""
    fh, fw = full.shape[:2]
    x1, y1, x2, y2 = (float(v) * f for v in box[:4])
    pw, ph = 0.05 * (x2 - x1), 0.03 * (y2 - y1)
    x1, x2 = int(max(0, x1 - pw)), int(min(fw, x2 + pw))
    y1, y2 = int(max(0, y1 - ph)), int(min(fh, y2 + ph))
    if x2 - x1 < 8 or y2 - y1 < 16:
        return None
    im = Image.fromarray(full[y1:y2, x1:x2])
    if im.height > max_h:
        im = im.resize((max(1, round(im.width * max_h / im.height)), max_h), Image.BILINEAR)
    return im


class Keeper:
    """Кандидати у вирізки для живих треків: (t, якість, вирізка, ціла?)."""

    def __init__(self, w: int, h: int, f: int, max_h: int):
        self.w, self.h, self.f, self.max_h = w, h, f, max_h
        self.cand = {}

    def see(self, t: float, full, alive) -> None:
        here = [tr for tr in alive if tr.last_t == t]
        for tr in here:
            b = tr.box
            conf = tr.points[-1][2]
            occl = max((overlap(b, o.box) for o in here if o.id != tr.id), default=0.0)
            # Рамка, обрізана краєм кадру (людина під самою камерою), — пів
            # людини згори; така вирізка гірша за цілу.
            edge = b[0] < 2 or b[2] > self.w - 2 or b[1] < 2 or b[3] > self.h - 2
            q = conf * (1.0 - occl) * (0.6 if edge else 1.0) * min(1.0, (b[3] - b[1]) / self.h / 0.45)
            im = crop_of(full, b, self.f, self.max_h)
            if im is None:
                continue
            c = self.cand.setdefault(tr.id, [])
            c.append((t, q, im, not edge and occl < 0.35))
            if len(c) > CAND_MAX:
                self.cand[tr.id] = c[::2]

    def take(self, track_id: int) -> list:
        return self.cand.pop(track_id, [])


def pick(cand: list, k: int) -> list:
    """До k вирізок рівно за часом, у кожному відрізку — найякісніша."""
    if len(cand) <= k:
        return sorted(cand, key=lambda c: c[0])
    cand = sorted(cand, key=lambda c: c[0])
    t0, t1 = cand[0][0], cand[-1][0]
    bins = [[] for _ in range(k)]
    for c in cand:
        i = min(k - 1, int((c[0] - t0) / max(1e-9, t1 - t0 + 1e-6) * k))
        bins[i].append(c)
    return [max(b, key=lambda c: c[1]) for b in bins if b]


def weights(chosen: list) -> list:
    """Вага вирізки у векторі проходу: якість, а перекриті чужою рамкою — нуль.

    Обрізані краєм кадру беруться, лише якщо цілих менше двох (як agg в
    аналізі архіву): пів людини згори псує вектор сильніше, ніж допомагає.
    """
    whole = sum(1 for c in chosen if c[3])
    return [c[1] if (c[3] or whole < 2) else 0.0 for c in chosen]


def strip(chosen: list, h: int, t0: float) -> tuple[bytes, list]:
    """Вирізки проходу в одну смужку JPEG і [[мс від початку, x, ширина, якість], ...].

    Одна смужка замість восьми файлів: один запис у R2 на прохід, і адмінка
    показує її одним зображенням. Окрему вирізку з неї дістає x і ширина.
    """
    ims = [c[2].resize((max(1, round(c[2].width * h / c[2].height)), h), Image.BILINEAR)
           for c in chosen]
    out = Image.new("RGB", (max(1, sum(i.width for i in ims)), h), (0, 0, 0))
    parts, x = [], 0
    for c, im in zip(chosen, ims):
        out.paste(im, (x, 0))
        parts.append([int(round((c[0] - t0) * 1000)), x, im.width, round(c[1], 3)])
        x += im.width
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=85)
    return buf.getvalue(), parts
