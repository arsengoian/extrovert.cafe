"""З треків — події, які потрібні адмінці: approach | queue | idle.

Три види покривають добу без дірок і відповідають на три різні питання:

  approach — людина біля стійки: коли підійшла, коли пішла, скільки стояла.
             Саме до неї потім чіпляється чек (`likely_receipt_id`).
  queue    — двоє й більше одночасно: черга, через яку хтось міг піти.
  idle     — біля стійки нікого. Це знаменник конверсії й видимі «мертві»
             години на графіку; без нього «20 підходів» нічого не означає.

Що НЕ рахуємо — ідентичність людини. Причина в `docs/video.md`: з цієї
камери 52 px між зіницями, і стабільного ID по обличчю не буде. Хто саме
підійшов — питання до POS, не до відео.

Зона стійки — полігон у частках кадру. Людина «в зоні», коли в полігон
потрапляє НИЗ її рамки по центру: це точка, де вона стоїть на підлозі.
Центр рамки для цього не годиться — високий чоловік на другому плані
центром лізе в зону, ногами стоячи за метр від неї.
"""
from dataclasses import dataclass


def point_in_poly(x: float, y: float, poly) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xx = x1 + (y - y1) * (x2 - x1) / ((y2 - y1) or 1e-9)
            if x < xx:
                inside = not inside
    return inside


def in_zone(box, poly, w: int, h: int) -> bool:
    x = (box[0] + box[2]) / 2 / w
    y = box[3] / h
    return point_in_poly(x, y, poly)


@dataclass
class Event:
    kind: str
    start_s: float
    end_s: float
    meta: dict
    open_start: bool = False
    open_end: bool = False
    # Кадр-доказ: (час, [рамки в частках кадру]). Рамки — ті, через які подію
    # порахували; у простою їх нема, і порожній кадр там якраз і є доказом.
    best: tuple | None = None


def _runs(times, flags, max_gap):
    """Максимальні проміжки, де flags істинний, з дозволеним розривом."""
    out, start, last = [], None, None
    for t, ok in zip(times, flags):
        if ok:
            if start is None:
                start = t
            elif t - last > max_gap:
                out.append((start, last))
                start = t
            last = t
    if start is not None:
        out.append((start, last))
    return out


def derive(tracks, times, zone, w, h, cfg, duration_s) -> list[Event]:
    if not times:
        return []
    step = 1.0 / cfg.sample_fps
    first, last = times[0], times[-1]
    events: list[Event] = []

    def frac(b):
        return (b[0] / w, b[1] / h, b[2] / w, b[3] / h)

    def edges(a, b):
        # Подія, що впирається в край сегмента, ймовірно триває далі —
        # позначаємо, щоб db.stitch зшив її з сусіднім сегментом.
        return a <= first + step / 2, b >= last - step / 2

    # ── approach ────────────────────────────────────────────────────────
    # zoned — лише ті відрізки треків, що самі тягнуть на підхід. Черга й
    # простій рахуються по них же: інакше уламок рамки (детектор інколи
    # дає другу, на руку чи пів тулуба тієї ж людини, і живе вона секунду)
    # роздував чергу на одну людину, а перехожий за дві секунди рвав простій
    # навпіл, хоча до кавʼярні не підходив (12.10.2026, сегмент 200019).
    zoned = {}
    for tr in tracks:
        pts = [(t, box, c) for t, box, c in tr.points if in_zone(box, zone, w, h)]
        if not pts:
            continue
        for a, b in _runs([p[0] for p in pts], [True] * len(pts), cfg.track_max_age_s):
            if b - a + step < cfg.approach_min_s:
                continue
            span = [p for p in pts if a <= p[0] <= b]
            zoned.setdefault(tr.id, []).extend(span)
            best = max(span, key=lambda p: p[2])
            o1, o2 = edges(a, b)
            events.append(Event(
                "approach", a, b + step,
                {"track": tr.id, "dwell_ms": int((b - a + step) * 1000),
                 "conf": round(max(p[2] for p in span), 3),
                 "frames": len(span),
                 "open_start": o1, "open_end": o2},
                o1, o2, (best[0], [frac(best[1])])))

    # ── queue / idle ────────────────────────────────────────────────────
    counts, present = [], []
    for t in times:
        here = [b for pts in zoned.values() for pt, b, _ in pts if abs(pt - t) < step / 2]
        counts.append(len(here))
        present.append(here)

    for a, b in _runs(times, [n >= cfg.queue_min_people for n in counts], step * 1.5):
        if b - a + step < cfg.queue_min_s:
            continue
        o1, o2 = edges(a, b)
        i = max((i for i, t in enumerate(times) if a <= t <= b), key=lambda i: counts[i])
        events.append(Event("queue", a, b + step,
                            {"max_people": counts[i], "open_start": o1, "open_end": o2}, o1, o2,
                            (times[i], [frac(x) for x in present[i]])))

    for a, b in _runs(times, [n == 0 for n in counts], step * 1.5):
        if b - a + step < cfg.idle_min_s:
            continue
        o1, o2 = edges(a, b)
        events.append(Event("idle", a, b + step, {"open_start": o1, "open_end": o2}, o1, o2,
                            ((a + b) / 2, [])))

    for e in events:
        e.end_s = min(e.end_s, duration_s or e.end_s)
    return sorted(events, key=lambda e: (e.start_s, e.kind))
