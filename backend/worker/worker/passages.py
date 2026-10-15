"""Проходи: людина від появи в кадрі до зникнення, зшита через розриви треку.

Трекер (track.py) рве людину, коли детектор губить її довше ніж на 1,5 с:
перекрила інша людина, пройшла під самою камерою. На архіві картки 09–14.10
це давало дві-три події «повз» на одну людину. Тому трек, що почався за
кілька секунд після кінця іншого там само, де той обірвався, і не надто
несхожий на нього за зовнішністю, — продовження того самого проходу.

Прохід несе все, що далі потрібно і подіям, і впізнаванню:
  points    — [[t, x1, y1, x2, y2, conf], ...] у частках кадру;
  direction — scene.direction: away | toward | near | far | uturn | uturn_far;
  heading   — що це значить на точці (scene.heading): in | out | None;
  crops     — до crops_per_passage вирізок рівно за часом: і спиною, і обличчям;
  emb       — вектор зовнішності (reid.py) і його вага.

Що не стає проходом узагалі: уламки рамок (events.is_person) і те, що
сидить у масці сцени, — відображення в дзеркалі в кінці коридору kyiv-01.
"""
from dataclasses import dataclass, field

import numpy as np

from . import crops as cr
from . import events as ev
from . import reid as rd
from . import scene as sc


@dataclass
class Passage:
    tracks: list
    points: list
    crops: list = field(default_factory=list)   # [(t, якість, PIL, ціла?)]
    emb: np.ndarray | None = None
    emb_w: float = 0.0
    direction: str = "far"
    start_depth: float = 0.0
    end_depth: float = 0.0
    min_depth: float = 0.0
    max_depth: float = 0.0
    heading: str | None = None
    zone_runs: list = field(default_factory=list)
    machine_runs: list = field(default_factory=list)
    open_start: bool = False
    open_end: bool = False

    @property
    def first_t(self) -> float:
        return self.points[0][0]

    @property
    def last_t(self) -> float:
        return self.points[-1][0]

    @property
    def conf(self) -> float:
        return max(p[5] for p in self.points)

    def at(self, t: float, tol: float):
        """Рамка проходу найближча до t (не далі tol) — [x1, y1, x2, y2] або None."""
        best = min(self.points, key=lambda p: abs(p[0] - t))
        return best[1:5] if abs(best[0] - t) <= tol else None


def _foot(p):
    return ((p[1] + p[3]) / 2, p[4])


def in_zone(p, zone) -> bool:
    x, y = _foot(p)
    return ev.point_in_poly(x, y, zone)


def sim(a, b) -> float | None:
    if a.emb is None or b.emb is None:
        return None
    return float(np.dot(a.emb, b.emb))


def build(tracks, cand: dict, reid, scene, cfg, w: int, h: int, times: list) -> list:
    """Треки сегмента → проходи (з напрямком, вирізками й вектором)."""
    if not times:
        return []
    step = 1.0 / cfg.sample_fps
    parts = []
    for tr in tracks:
        pts = [[t, b[0] / w, b[1] / h, b[2] / w, b[3] / h, c] for t, b, c in tr.points]
        if sc.masked(pts, scene):
            continue
        zt = [p[0] for p in pts if in_zone(p, scene.zone)]
        near = any(b - a + step >= cfg.approach_min_s for a, b in _runs(zt, cfg.track_max_age_s))
        if not (near or ev.is_person(tr, tracks, step, cfg)):
            continue
        chosen = cr.pick(cand.get(tr.id, []), cfg.crops_per_passage)
        p = Passage([tr.id], pts, chosen)
        vecs = reid.embed([c[2] for c in chosen]) if reid is not None else None
        if vecs is not None:
            p.emb, p.emb_w = rd.mean_vec(vecs, cr.weights(chosen))
        parts.append(p)
    out = join(parts, cfg)
    for p in out:
        classify(p, scene, cfg, times, step)
    return out


def join(parts: list, cfg) -> list:
    """Зшити шматки одного проходу: розрив ≤ join_gap_s, там само, не надто несхожі."""
    out = []
    for t in sorted(parts, key=lambda x: x.first_t):
        best = None
        for g in out:
            gap = t.first_t - g.last_t
            if not (0 < gap <= cfg.join_gap_s):
                continue
            (ax, ay), (bx, by) = _foot(g.points[-1]), _foot(t.points[0])
            if ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 > cfg.join_dist:
                continue
            s = sim(g, t)
            score = 0.5 if s is None else s
            if score >= cfg.join_sim and (best is None or score > best[0]):
                best = (score, g)
        if best is None:
            out.append(t)
            continue
        g = best[1]
        g.tracks += t.tracks
        g.points += t.points
        g.crops = cr.pick(g.crops + t.crops, cfg.crops_per_passage)
        g.emb, g.emb_w = rd.merge(g.emb, g.emb_w, t.emb, t.emb_w)
    return out


def classify(p: Passage, scene, cfg, times: list, step: float) -> None:
    d = sc.direction(p.points, cfg.move_depth)
    p.direction = d["direction"]
    p.start_depth, p.end_depth = d["start_depth"], d["end_depth"]
    p.min_depth, p.max_depth = d["min_depth"], d["max_depth"]
    p.heading = scene.heading_of(p.direction)
    # Прохід, що впирається в край сегмента, ймовірно триває в сусідньому —
    # db.write_passages дошиває його до проходу попереднього сегмента.
    p.open_start = p.first_t <= times[0] + step / 2
    p.open_end = p.last_t >= times[-1] - step / 2
    zt = [q[0] for q in p.points if in_zone(q, scene.zone)]
    p.zone_runs = _runs(zt, cfg.track_max_age_s)
    p.machine_runs = sc.machine_runs(p.points, scene.machine, step, cfg.track_max_age_s)


def _runs(ts, max_gap):
    out, start, last = [], None, None
    for t in ts:
        if start is None:
            start = t
        elif t - last > max_gap:
            out.append((start, last))
            start = t
        last = t
    if start is not None:
        out.append((start, last))
    return out


def compact(points: list, t0: float) -> list:
    """Точки для бази: [[мс від t0, x1, y1, x2, y2], ...], три знаки."""
    return [[int(round((q[0] - t0) * 1000)), round(q[1], 3), round(q[2], 3),
             round(q[3], 3), round(q[4], 3)] for q in points]
