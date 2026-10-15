"""Проходи → люди → візити. Робота воркера між сегментами (main.py).

Людина — кластер проходів, схожих за одягом (вектори reid.py), не довший
за person_span_h годин: далі одяг уже не тримає ідентичність (переодягнувся,
інша людина в такій самій чорній куртці). Кластеризація агломеративна із
середнім звʼязком, поріг people_thr; два проходи, що були в кадрі однієї
камери одночасно, — завжди різні люди.

Клуб цілодобовий, тож жодної межі доби тут немає: людина, що прийшла о
23:00 і пішла о 03:00, — один візит. Замість діб — ковзне вікно WINDOW_H
годин, що закінчується в мить T. Кожен запуск переписує людей, які
зʼявились у вікні, з нуля; люди, що почались раніше й тривають у вікно, —
«насіння»: їхні старі проходи лишаються з ними, а нові можуть до них
доєднатись. Через це id людини — не стабільний ключ, а номер у поточному
розкладі.

Після кластеризації:
  * персонал — кластер зі staff_passes+ проходами (адміністратор проходить
    коридором 50–80 разів за зміну, гість — 2–6); схожі на нього дрібні
    кластери (staff_absorb) — теж він: проходи впритул до камери чи в натовпі
    до порогу не дотягують;
  * добирання: «зайшов і не вийшов» ↔ «вийшов, не зайшовши» — спина (вхід)
    і обличчя (вихід) однієї людини схожі менше, ніж дві спини, тож такі
    половинки лишаються окремими кластерами; зводимо їх нижчим порогом
    link_thr, кожну щонайбільше в одну пару;
  * візити — від входу до виходу; перерва до visit_break_min візит не рве.

Заміри порогів — docs/video.md, «Люди й візити».
"""
from datetime import timedelta

import numpy as np

from . import log

WINDOW_H = 26.0     # вікно перерахунку: доба й запас під людину на межі
STEP_H = 20.0       # крок наздоганяння історії (переаналіз, імпорт картки)

IDENT = "embedding is not null and max_depth >= %(near)s"


class P:
    """Прохід для кластеризації."""
    __slots__ = ("id", "camera", "t0", "t1", "emb", "direction", "heading", "person")

    def __init__(self, row):
        self.id = row["id"]
        self.camera = row["camera_id"]
        self.t0 = row["started_at"]
        self.t1 = row["ended_at"]
        self.emb = np.asarray(row["embedding"], np.float32)
        self.direction = row["direction"]
        self.heading = row["heading"]
        self.person = row.get("person_id")


def cluster(items: list[list[P]], frozen: list[bool], cfg) -> list[list[P]]:
    """Агломеративна кластеризація груп проходів (середній звʼязок).

    items — початкові групи: насіння (frozen) і поодинокі проходи. Дві
    групи насіння не зливаються: це дві різні вже відомі людини.
    """
    n = len(items)
    if n == 0:
        return []
    members = [p for g in items for p in g]
    owner = np.repeat(np.arange(n), [len(g) for g in items])
    E = np.stack([p.emb for p in members])
    PS = E @ E.T
    A = np.zeros((n, len(members)), np.float32)
    A[owner, np.arange(len(members))] = 1.0
    size = A.sum(1)
    S = (A @ PS @ A.T) / np.outer(size, size)

    # Одночасно в кадрі однієї камери — різні люди.
    t0 = np.array([p.t0.timestamp() for p in members])
    t1 = np.array([p.t1.timestamp() for p in members])
    cam = np.array([p.camera for p in members])
    clash = (t0[:, None] < t1[None, :] - 0.5) & (t0[None, :] < t1[:, None] - 0.5)
    clash &= cam[:, None] == cam[None, :]
    np.fill_diagonal(clash, False)
    bad = (A @ clash.astype(np.float32) @ A.T) > 0
    fz = np.array(frozen)
    bad |= fz[:, None] & fz[None, :]
    S[bad] = -np.inf
    np.fill_diagonal(S, -np.inf)

    lo = np.array([min(p.t0 for p in g).timestamp() for g in items])
    hi = np.array([max(p.t1 for p in g).timestamp() for g in items])
    span = cfg.person_span_h * 3600
    groups = {i: list(g) for i, g in enumerate(items)}
    is_frozen = list(frozen)
    while True:
        k = int(np.argmax(S))
        i, j = divmod(k, n)
        if S[i, j] < cfg.people_thr:
            break
        if max(hi[i], hi[j]) - min(lo[i], lo[j]) > span:
            S[i, j] = S[j, i] = -np.inf
            continue
        if is_frozen[j] and not is_frozen[i]:
            i, j = j, i     # насіння лишається тим самим рядком
        new = (S[i] * size[i] + S[j] * size[j]) / (size[i] + size[j])
        new[np.isneginf(S[i]) | np.isneginf(S[j])] = -np.inf
        S[i, :] = new
        S[:, i] = new
        S[i, i] = -np.inf
        S[j, :] = -np.inf
        S[:, j] = -np.inf
        size[i] += size[j]
        lo[i], hi[i] = min(lo[i], lo[j]), max(hi[i], hi[j])
        groups[i] += groups.pop(j)
        is_frozen[i] = is_frozen[i] or is_frozen[j]
    return [sorted(g, key=lambda p: p.t0) for g in groups.values()]


def mean_sim(a: list[P], b: list[P]) -> float:
    return float((np.stack([p.emb for p in a]) @ np.stack([p.emb for p in b]).T).mean())


def marks(seq: list[P], heading_of) -> list:
    """Проходи людини → [(in|out, час)]."""
    out = []
    for p in seq:
        if p.heading == "in":
            out.append(("in", p.t0))
        elif p.heading == "out":
            out.append(("out", p.t1))
        elif p.direction == "uturn":
            # З глибини до камери й назад: вийшла до рецепції й повернулась.
            a, b = heading_of(p.camera, "toward"), heading_of(p.camera, "away")
            if a and b:
                out.append((a, p.t0))
                out.append((b, p.t1))
        # uturn_far (від камери вглиб і назад), near, far візиту не роблять:
        # так ходять ті, хто й так біля рецепції, — персонал, гості кавʼярні.
    return out


def visits(seq: list[P], heading_of, break_min: float) -> list:
    """[(вхід | None, вихід | None, кількість проходів)]."""
    out, cur = [], None
    gap = timedelta(minutes=break_min)
    for kind, t in marks(seq, heading_of):
        if kind == "in":
            if cur is not None and cur[1] is not None and t - cur[1] > gap:
                out.append(cur)
                cur = None
            if cur is None:
                cur = [t, None, 1]
            else:
                cur[1] = None       # повернувся з перерви — візит триває
                cur[2] += 1
        else:
            if cur is None:
                cur = [None, t, 1]  # зайшов раніше, ніж ми бачимо
            else:
                cur[1] = t
                cur[2] += 1
    if cur is not None:
        out.append(cur)
    return [tuple(v) for v in out]


def step(conn, cfg, point: str, T) -> dict:
    """Перерахувати людей і візити точки у вікні [T − WINDOW_H, T]."""
    w0 = T - timedelta(hours=WINDOW_H)
    heading = {}

    def heading_of(camera, direction):
        if camera not in heading:
            heading[camera] = cfg.scene_for(point, camera).heading or {}
        return heading[camera].get(direction)

    q = {"point": point, "w0": w0, "T": T, "near": cfg.near_min_depth}
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "select id from video_people where point_id = %(point)s "
            "and first_seen < %(w0)s and last_seen >= %(w0)s", q)
        seeds_ids = [r["id"] for r in cur.fetchall()]
        cur.execute("delete from video_people where point_id = %(point)s "
                    "and first_seen >= %(w0)s and first_seen <= %(T)s", q)
        cur.execute("update video_passages set person_id = null where point_id = %(point)s "
                    "and started_at >= %(w0)s and started_at <= %(T)s and person_id is not null", q)
        cur.execute("delete from video_visits where person_id = any(%(ids)s)", {"ids": seeds_ids})
        cols = "id, camera_id, started_at, ended_at, embedding, direction, heading, person_id"
        cur.execute(f"select {cols} from video_passages where point_id = %(point)s "
                    f"and started_at >= %(w0)s and started_at <= %(T)s and {IDENT} "
                    "order by started_at", q)
        free = [P(r) for r in cur.fetchall()]
        cur.execute(f"select {cols} from video_passages where person_id = any(%(ids)s) "
                    "order by started_at", {"ids": seeds_ids})
        seed = {}
        for r in cur.fetchall():
            seed.setdefault(r["person_id"], []).append(P(r))
        seed_ids = [i for i in seeds_ids if i in seed]

        items = [seed[i] for i in seed_ids] + [[p] for p in free]
        frozen = [True] * len(seed_ids) + [False] * len(free)
        groups = cluster(items, frozen, cfg)
        pid_of = {}
        for g in groups:
            for p in g:
                if p.person is not None:
                    pid_of[id(g)] = p.person

        # Персонал і те, що на нього схоже.
        staff = [g for g in groups if len(g) >= cfg.staff_passes]
        gone = set()
        for s in staff:
            for g in groups:
                if g is s or id(g) in gone or len(g) >= cfg.staff_passes:
                    continue
                if id(g) in pid_of and id(s) in pid_of:
                    continue
                if mean_sim(g, s) >= cfg.staff_absorb:
                    s += g
                    s.sort(key=lambda p: p.t0)
                    gone.add(id(g))
                    if id(g) in pid_of and id(s) not in pid_of:
                        pid_of[id(s)] = pid_of[id(g)]
        groups = [g for g in groups if id(g) not in gone]
        staff_ids = {id(s) for s in staff}

        # Добирання половинок візиту: вхід без виходу ↔ вихід без входу.
        vis = {id(g): visits(g, heading_of, cfg.visit_break_min) for g in groups}
        opens = [g for g in groups if id(g) not in staff_ids and vis[id(g)]
                 and vis[id(g)][-1][0] is not None and vis[id(g)][-1][1] is None]
        closes = [g for g in groups if id(g) not in staff_ids and vis[id(g)]
                  and vis[id(g)][0][0] is None and vis[id(g)][0][1] is not None]
        pairs = []
        span = timedelta(hours=cfg.person_span_h)
        for a in opens:
            t_in = vis[id(a)][-1][0]
            for b in closes:
                if a is b or (id(a) in pid_of and id(b) in pid_of):
                    continue
                t_out = vis[id(b)][0][1]
                if not (timedelta(minutes=5) <= t_out - t_in <= span):
                    continue
                if b[0].t0 <= a[-1].t1:
                    continue
                s = mean_sim(a, b)
                if s >= cfg.link_thr:
                    pairs.append((s, a, b))
        used = set()
        linked = 0
        for s, a, b in sorted(pairs, key=lambda x: -x[0]):
            if id(a) in used or id(b) in used:
                continue
            used.update((id(a), id(b)))
            a += b
            a.sort(key=lambda p: p.t0)
            if id(b) in pid_of and id(a) not in pid_of:
                pid_of[id(a)] = pid_of[id(b)]
            gone.add(id(b))
            linked += 1
        groups = [g for g in groups if id(g) not in gone]

        n_visits = 0
        for g in groups:
            is_staff = id(g) in staff_ids or len(g) >= cfg.staff_passes
            first, last = min(p.t0 for p in g), max(p.t1 for p in g)
            pid = pid_of.get(id(g))
            if pid is not None:
                cur.execute("update video_people set first_seen = %s, last_seen = %s, passages = %s, "
                            "staff = %s, computed_at = now() where id = %s",
                            (first, last, len(g), is_staff, pid))
            else:
                cur.execute("insert into video_people (point_id, first_seen, last_seen, passages, staff) "
                            "values (%s, %s, %s, %s, %s) returning id",
                            (point, first, last, len(g), is_staff))
                pid = cur.fetchone()["id"]
            cur.execute("update video_passages set person_id = %s where id = any(%s)",
                        (pid, [p.id for p in g]))
            for a, b, k in visits(g, heading_of, cfg.visit_break_min):
                cur.execute("insert into video_visits (person_id, point_id, entered_at, left_at, passages) "
                            "values (%s, %s, %s, %s, %s)", (pid, point, a, b, k))
                n_visits += 1
    return {"point": point, "from": w0, "to": T, "passages": len(free), "seeds": len(seed_ids),
            "people": len(groups), "staff": sum(1 for g in groups if len(g) >= cfg.staff_passes),
            "linked": linked, "visits": n_visits}


def due(conn, cfg) -> list:
    """[(точка, T, now)] — де є проходи без людини. Давні — кроком STEP_H, свіжі — до now()."""
    out = []
    with conn.cursor() as cur:
        cur.execute(
            f"select point_id, min(started_at) as t0, now() as now from video_passages "
            f"where person_id is null and {IDENT} group by point_id", {"near": cfg.near_min_depth})
        for r in cur.fetchall():
            T = min(r["t0"] + timedelta(hours=STEP_H), r["now"])
            out.append((r["point_id"], T, r["now"]))
    return out


def run(conn, cfg) -> list:
    """Один крок для кожної точки, де є що рахувати."""
    done = []
    for point, T, now in due(conn, cfg):
        s = step(conn, cfg, point, T)
        s["now"] = now
        log.info("люди перераховані", **{k: (v.isoformat(timespec="minutes") if hasattr(v, "isoformat") else v)
                                          for k, v in s.items() if k != "now"})
        done.append(s)
    return done
