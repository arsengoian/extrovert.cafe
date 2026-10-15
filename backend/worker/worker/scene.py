"""Геометрія сцени: маски, глибина в коридорі, напрямок, автомат.

Точка треку — [t, x1, y1, x2, y2, conf] у частках кадру (0..1). Усе, що
залежить від конкретної камери, приходить у Scene (config.scene_for); тут
лише правила, однакові для всіх точок.

Глибина — де людина стоїть у коридорі: низ рамки (ноги на підлозі). Біля
дальнього кінця коридору — ~0,3 кадру, під самою камерою рамка обрізана
низом кадру, і тоді глибину добудовує верх рамки: що ближче людина, то
вище маківка (до ~1,03).
"""
from statistics import median

CUT = 0.97          # низ рамки нижче — ноги вже за кадром, людина під камерою


def depth_of(p) -> float:
    y2 = p[4]
    if y2 < CUT:
        return y2
    return CUT + 0.25 * max(0.0, 0.25 - p[2])


def in_mask(p, mask) -> bool:
    x1, y1, x2, y2 = mask["rect"]
    return p[1] >= x1 and p[3] <= x2 and p[2] >= y1 and p[4] <= y2


def masked(points, scene) -> str | None:
    """Назва маски, у якій трек сидить більшу частину часу (дзеркало) — або None."""
    for m in scene.masks:
        inside = sum(1 for p in points if in_mask(p, m))
        if points and inside >= m.get("share", 0.6) * len(points):
            return m.get("name", "mask")
    return None


def direction(points, move: float) -> dict:
    """Звідки й куди змістились ноги: away | toward | near | far | uturn | uturn_far."""
    d = [depth_of(p) for p in points]
    k = max(1, min(3, len(d) // 3))
    s, e = float(median(d[:k])), float(median(d[-k:]))
    lo, hi = float(min(d)), float(max(d))
    if e - s >= move:
        kind = "toward"
    elif s - e >= move:
        kind = "away"
    elif hi - max(s, e) >= move and hi >= CUT:
        kind = "uturn"          # з глибини до камери й назад
    elif min(s, e) - lo >= move:
        kind = "uturn_far"      # від камери вглиб і назад
    elif lo >= 0.8:
        kind = "near"
    else:
        kind = "far"
    return {"direction": kind, "start_depth": s, "end_depth": e,
            "min_depth": lo, "max_depth": hi}


def machine_runs(points, machine: dict | None, step: float, max_gap: float) -> list:
    """Проміжки [(t0, t1)], коли людина стоїть упритул до автомата.

    Упритул — рамка обрізана низом кадру й лівою межею не правіше x1_max
    (автомат під камерою, людина тягнеться до екрана й видачі). Стоїть —
    центр рамки зсувається в середньому не більш як на max_move кадру за
    крок. Заміри — scenes.json, kyiv-01.
    """
    if not machine:
        return []
    near = [p for p in points if p[4] >= machine.get("cut_y", CUT)]
    runs, cur = [], []
    for p in near:
        if cur and p[0] - cur[-1][0] > max_gap:
            runs.append(cur)
            cur = []
        cur.append(p)
    if cur:
        runs.append(cur)
    out = []
    for run in runs:
        if run[-1][0] - run[0][0] + step < machine.get("min_s", 4.0):
            continue
        x1 = median(p[1] for p in run)
        if x1 > machine.get("x1_max", 0.34):
            continue
        cx = [(p[1] + p[3]) / 2 for p in run]
        move = sum(abs(b - a) for a, b in zip(cx, cx[1:])) / max(1, len(cx) - 1)
        if move > machine.get("max_move", 0.055):
            continue
        out.append((run[0][0], run[-1][0]))
    return out


def at_machine(p, machine: dict | None) -> bool:
    """Одна точка треку: чи стоїть людина в цю мить там, де стоять біля автомата."""
    if not machine:
        return False
    return p[4] >= machine.get("cut_y", CUT) and p[1] <= machine.get("x1_max", 0.34)
