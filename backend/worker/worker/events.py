"""З проходів (passages.py) — події, які потрібні адмінці.

  approach — людина біля стійки: коли підійшла, коли пішла, скільки стояла.
  machine  — людина впритул до самого автомата, лицем до нього (scene.machine):
             не тупцює в коридорі біля камери, а дивиться на екран чи
             забирає напій. Це кандидат у покупці; без розмітки автомата в
             сцені точки цієї події немає.
  pass     — людина пройшла в кадрі, але до кавʼярні не підійшла. Разом із
             approach це знаменник конверсії: який відсоток тих, хто
             проходить повз, підходить (власник, 12.10.2026). Один прохід —
             або approach, або pass; machine — додатково до approach.
  queue    — двоє й більше біля стійки одночасно: черга, через яку хтось
             міг піти.

Порожню стійку окремою подією не пишемо (до 12.10.2026 це був `idle`):
порожнеча — це відсутність подій, і складувати її рядками сенсу немає.

Хто саме ця людина — не тут: обличчя з цієї камери не впізнати (52 px між
зіницями), а впізнавання за одягом в межах доби робить people.py з векторів
проходів.

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
    # Прохід, з якого подія (у черги — None) і три миті для аркуша-доказу:
    # початок, найпевніший кадр, кінець.
    passage: object = None
    moments: tuple = ()


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


def derive(passages, times, cfg, duration_s) -> list[Event]:
    if not times:
        return []
    step = 1.0 / cfg.sample_fps
    first, last = times[0], times[-1]
    events: list[Event] = []

    def edges(a, b):
        # Подія, що впирається в край сегмента, ймовірно триває далі —
        # позначаємо, щоб db.write_events зшив її з сусіднім сегментом.
        return a <= first + step / 2, b >= last - step / 2

    def event(kind, p, a, b, extra=None):
        span = [q for q in p.points if a <= q[0] <= b]
        best = max(span, key=lambda q: q[5])
        o1, o2 = edges(a, b)
        meta = {"dwell_ms": int((b - a + step) * 1000),
                "conf": round(best[5], 3), "frames": len(span),
                "direction": p.direction, "heading": p.heading,
                "open_start": o1, "open_end": o2, **(extra or {})}
        return Event(kind, a, b + step, meta, o1, o2, p, (a, best[0], b))

    # ── approach і machine ──────────────────────────────────────────────
    # zoned — точки проходів, що самі тягнуть на підхід. Черга рахується по
    # них же: інакше уламок рамки (детектор інколи дає другу, на руку чи пів
    # тулуба тієї ж людини) роздував чергу на одну людину (12.10.2026).
    zoned = {}
    for i, p in enumerate(passages):
        for a, b in p.zone_runs:
            if b - a + step < cfg.approach_min_s:
                continue
            zoned.setdefault(i, []).extend(q for q in p.points if a <= q[0] <= b)
            events.append(event("approach", p, a, b))
        for a, b in p.machine_runs:
            events.append(event("machine", p, a, b))

    # ── pass ────────────────────────────────────────────────────────────
    # Хто був у кадрі, але жодного разу не тягнув на підхід. Прохід, що
    # підходив, сюди не йде навіть частиною: одна людина — одна подія.
    for i, p in enumerate(passages):
        if i not in zoned:
            events.append(event("pass", p, p.first_t, p.last_t))

    # ── queue ───────────────────────────────────────────────────────────
    counts = []
    for t in times:
        counts.append(sum(1 for pts in zoned.values() if any(abs(q[0] - t) < step / 2 for q in pts)))

    for a, b in _runs(times, [n >= cfg.queue_min_people for n in counts], step * 1.5):
        if b - a + step < cfg.queue_min_s:
            continue
        o1, o2 = edges(a, b)
        i = max((i for i, t in enumerate(times) if a <= t <= b), key=lambda i: counts[i])
        events.append(Event("queue", a, b + step,
                            {"max_people": counts[i], "open_start": o1, "open_end": o2},
                            o1, o2, None, (a, times[i], b)))

    for e in events:
        e.end_s = min(e.end_s, duration_s or e.end_s)
    return sorted(events, key=lambda e: (e.start_s, e.kind))
