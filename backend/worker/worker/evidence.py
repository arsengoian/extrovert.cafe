"""Аркуш-доказ події: три кадри й вирізки людини одним JPEG.

До 15.10.2026 доказом був один кадр (frame_00.jpg) — мить, де детектор
найпевніший. З одного кадру не видно, що людина робила: підійшла до
автомата чи пройшла повз, хто стояв поруч. Аркуш — як картки покупок в
аналізі архіву картки: початок, найпевніший кадр і кінець події з рамками
(червона — людина події, жовті — інші в кадрі, блакитна лінія — межа зони
біля кавʼярні) і під ними вирізки цієї людини з усього проходу.

Кадри беруться з тих, що вже пройшли через детектор (pipeline.Result.thumbs),
а не окремим запуском ffmpeg на кожну мить: подій сотні на добу, і три
зайві декоди на кожну коштували б більше, ніж уся детекція.
"""
import io
from datetime import timedelta
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

KYIV = ZoneInfo("Europe/Kyiv")
FW, FH = 480, 270
CROP_H = 150
PAD = 4
LABELS = ("start", "peak", "end")
RED, YELLOW, CYAN, WHITE = (255, 40, 40), (255, 210, 0), (0, 200, 255), (255, 255, 255)

try:
    FONT = ImageFont.load_default(size=16)
except TypeError:      # Pillow < 10.1 — растровий шрифт без розміру
    FONT = ImageFont.load_default()


def _nearest(thumbs: dict, t: float):
    if not thumbs:
        return None, None
    k = min(thumbs, key=lambda x: abs(x - t))
    return k, thumbs[k]


def frame(res, t: float, passages, mark: set, zone_y: float | None, label: str) -> Image.Image:
    k, data = _nearest(res.thumbs, t)
    if data is None:
        im = Image.new("RGB", (FW, FH), (30, 30, 30))
    else:
        im = Image.open(io.BytesIO(data)).convert("RGB").resize((FW, FH), Image.BILINEAR)
    d = ImageDraw.Draw(im)
    if zone_y is not None:
        d.line([(0, zone_y * FH), (FW, zone_y * FH)], fill=CYAN, width=1)
    tol = 0.6
    for i, p in enumerate(passages):
        b = p.at(k if k is not None else t, tol)
        if b is None:
            continue
        hot = i in mark
        d.rectangle([b[0] * FW, b[1] * FH, b[2] * FW, b[3] * FH],
                    outline=RED if hot else YELLOW, width=3 if hot else 1)
    d.rectangle([0, FH - 22, FW, FH], fill=(0, 0, 0))
    d.text((6, FH - 20), label, fill=WHITE, font=FONT)
    return im


def sheet(e, res, scene, base) -> bytes:
    """Подія → JPEG аркуша. base — час початку сегмента (UTC)."""
    passages = res.passages
    if e.passage is not None:
        mark = {i for i, p in enumerate(passages) if p is e.passage}
        rows = [e.passage]
    else:
        # Черга: усі, хто в мить піку стояв у зоні.
        peak = e.moments[1]
        mark = {i for i, p in enumerate(passages)
                if any(abs(q[0] - peak) < 0.6 and q[4] >= _zone_top(scene) for q in p.points)}
        rows = [passages[i] for i in sorted(mark)]
    zone_y = _zone_top(scene)
    ims = []
    for name, t in zip(LABELS, e.moments):
        wall = (base + timedelta(seconds=t)).astimezone(KYIV)
        ims.append(frame(res, t, passages, mark, zone_y, f"{name}  {wall:%d.%m %H:%M:%S}"))

    crops = []
    for p in rows:
        for c in p.crops:
            im = c[2]
            crops.append(im.resize((max(1, round(im.width * CROP_H / im.height)), CROP_H), Image.BILINEAR))
    width = len(ims) * FW + (len(ims) - 1) * PAD
    out = Image.new("RGB", (width, FH + (PAD + CROP_H if crops else 0)), (20, 20, 20))
    for i, im in enumerate(ims):
        out.paste(im, (i * (FW + PAD), 0))
    x = 0
    for im in crops:
        if x + im.width > width:
            break
        out.paste(im, (x, FH + PAD))
        x += im.width + 2
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def _zone_top(scene) -> float | None:
    ys = [pt[1] for pt in (scene.zone or [])]
    return min(ys) if ys and min(ys) > 0 else None
