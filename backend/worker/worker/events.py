"""З треків — події, які потрібні адмінці: approach | pass | queue.

  approach — людина біля стійки: коли підійшла, коли пішла, скільки стояла.
             Саме до неї потім чіпляється чек (`likely_receipt_id`).
  pass     — людина пройшла в кадрі, але до кавʼярні не підійшла. Разом із
             approach це знаменник конверсії: який відсоток тих, хто
             проходить повз, підходить (власник, 12.10.2026). Одна людина —
             одна подія: або approach, або pass.
  queue    — двоє й більше біля стійки одночасно: черга, через яку хтось
             міг піти.

Порожню стійку окремою подією не пишемо (до 12.10.2026 це був `idle`):
порожнеча — це відсутність подій, і складувати її рядками сенсу немає.

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
    # Кадр-доказ: (час, [рамки в частках кадру]) — ті рамки, через які подію
    # порахували.
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


def _inside(a, b) -> float:
    """Яка частка рамки a лежить усередині рамки b."""
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    return inter / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))


def _covered(tr, tracks, step) -> float:
    """Найбільша частка, якою рамка треку сиділа в рамці ІНШОГО треку в ту ж мить."""
    best = 0.0
    for other in tracks:
        if other.id == tr.id:
            continue
        at = {round(t / step): b for t, b, _ in other.points}
        for t, b, _ in tr.points:
            ob = at.get(round(t / step))
            if ob is not None:
                best = max(best, _inside(b, ob))
    return best


def is_person(tr, tracks, step, cfg) -> bool:
    """Чи трек — окрема людина, а не уламок чужої рамки.

    Заміри 12.10.2026 на 29 сегментах: уламки (постер на стіні, рука чи пів
    тулуба людини, що вже має свою рамку) живуть 1–2 кадри й на 30–96 %
    сидять у чужій рамці. Перехожий біля самої камери проскакує за 2 кадри,
    але ні з ким не перетинається. Тож: один кадр — шум; два — лише якщо
    рамка стоїть окремо; від трьох — людина, якщо не сидить у чужій рамці
    більш ніж на 60 % (так виглядає той, хто вже підходив, а тепер іде геть
    під новим треком, — другий раз його не рахуємо).
    """
    n = len(tr.points)
    if n < cfg.pass_min_frames:
        return False
    limit = cfg.fragment_cover if n < 3 else cfg.shadow_cover
    return _covered(tr, tracks, step) < limit


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
    # zoned — лише ті відрізки треків, що самі тягнуть на підхід. Черга
    # рахується по них же: інакше уламок рамки (детектор інколи дає другу,
    # на руку чи пів тулуба тієї ж людини, і живе вона секунду) роздував
    # чергу на одну людину (12.10.2026, сегмент 200019).
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

    # ── pass ────────────────────────────────────────────────────────────
    # Хто був у кадрі, але жодного разу не тягнув на підхід. Трек, що
    # підходив, сюди не йде навіть частиною: одна людина — одна подія.
    for tr in tracks:
        if tr.id in zoned or not is_person(tr, tracks, step, cfg):
            continue
        a, b = tr.first_t, tr.last_t
        best = max(tr.points, key=lambda p: p[2])
        o1, o2 = edges(a, b)
        events.append(Event(
            "pass", a, b + step,
            {"track": tr.id, "dwell_ms": int((b - a + step) * 1000),
             "conf": round(best[2], 3), "frames": len(tr.points),
             "open_start": o1, "open_end": o2},
            o1, o2, (best[0], [frac(best[1])])))

    # ── queue ───────────────────────────────────────────────────────────
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

    for e in events:
        e.end_s = min(e.end_s, duration_s or e.end_s)
    return sorted(events, key=lambda e: (e.start_s, e.kind))
