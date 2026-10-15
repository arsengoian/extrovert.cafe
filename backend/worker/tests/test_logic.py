"""Перевірка логіки, яку не видно на відео: трек, прохід, зона, межі подій, люди.

Без pytest і без моделі — голі assert, щоб запускалось у тому ж образі, що
й воркер: `python -m tests.test_logic`. Логіка тут рівно та, через яку
проходить кожен сегмент, і помилка в ній не впаде, а тихо зіпсує
статистику — саме такі й ловлять тестом.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config, events as ev, passages as ps, people, reid as rd  # noqa: E402
from worker import crops as cr  # noqa: E402
from worker.config import Scene  # noqa: E402
from worker.track import Tracker, affinity  # noqa: E402

W = H = 1000
ZONE = [[0.0, 0.5], [1.0, 0.5], [1.0, 1.0], [0.0, 1.0]]  # нижня половина кадру
SCENE = Scene(zone=ZONE)


def box(cx, cy, w=100, h=200):
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 0.9]


def derive(tr, times, cfg, duration, scene=SCENE):
    """Треки → проходи → події, як у pipeline.process (без вирізок і векторів)."""
    found = ps.build(tr.finish(), {}, None, scene, cfg, W, H, times)
    return ev.derive(found, times, cfg, duration), found


def test_zone_by_feet():
    # Центр рамки в зоні, ноги — ні: людина стоїть вище за стійку.
    assert not ev.in_zone(box(500, 380)[:4], ZONE, W, H)
    assert ev.in_zone(box(500, 450)[:4], ZONE, W, H)


def test_track_survives_gap_between_boxes():
    # 2 fps: за пів секунди людина зміщується на ширину рамки, IoU нульовий.
    a, b = box(300, 700)[:4], box(420, 700)[:4]
    assert affinity(a, b) == 0.0 or affinity(a, b) > 0
    tr = Tracker(max_age_s=1.5, min_score=0.2)
    tr.update(0.0, [box(300, 700)])
    tr.update(0.5, [box(420, 700)])
    tr.update(1.0, [box(540, 700)])
    tracks = tr.finish()
    assert len(tracks) == 1, f"підхід розпався на {len(tracks)} треків"
    assert tracks[0].seen == 3


def test_approach_without_idle():
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(40)]  # 20 секунд
    for t in times:
        # людина стоїть біля стійки з 2-ї по 8-му секунду
        tr.update(t, [box(500, 700)] if 2.0 <= t <= 8.0 else [])
    found, _ = derive(tr, times, cfg, 20.0)
    assert [e.kind for e in found] == ["approach"], [e.kind for e in found]
    app = found[0]
    assert 6.0 <= app.end_s - app.start_s <= 7.5, (app.start_s, app.end_s)
    assert not app.open_start and not app.open_end


def test_walker_is_a_pass_not_an_approach():
    # Іде коридором (ноги вище за зону) — перехожий. Одна людина — одна подія.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        tr.update(t, [box(100 + 120 * t, 300)] if 1.0 <= t <= 4.0 else [])
    found, _ = derive(tr, times, cfg, 10.0)
    assert [e.kind for e in found] == ["pass"], [e.kind for e in found]
    assert found[0].meta["frames"] == 7


def test_approacher_is_not_also_a_pass():
    # Прийшов коридором і став біля стійки — це підхід, і лише підхід.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(30)]
    for t in times:
        y = 300 + 100 * t if t < 4.0 else 700  # ноги сповзають у зону
        tr.update(t, [box(500, y)])
    found, _ = derive(tr, times, cfg, 15.0)
    assert [e.kind for e in found] == ["approach"], [e.kind for e in found]


def test_queue_needs_two():
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        boxes = [box(400, 700)]
        if 2.0 <= t <= 7.0:
            boxes.append(box(700, 750))
        tr.update(t, boxes)
    found, _ = derive(tr, times, cfg, 10.0)
    queues = [e for e in found if e.kind == "queue"]
    assert len(queues) == 1, [(e.kind, e.start_s, e.end_s) for e in found]
    assert queues[0].meta["max_people"] == 2
    assert len([e for e in found if e.kind == "approach"]) == 2


def test_fragment_does_not_count_as_person():
    # Уламок рамки на секунду всередині справжньої людини — не третій у черзі
    # і не перехожий. Окремий шум на один кадр — теж не перехожий.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(40)]
    for t in times:
        boxes = []
        if 2.0 <= t <= 12.0:
            boxes += [box(300, 700), box(700, 750)]
        if 5.0 <= t <= 5.5:
            boxes.append(box(300, 680, w=60, h=150))  # сидить у рамці першого
        if t == 15.0:
            boxes.append(box(500, 300))  # один кадр де завгодно
        tr.update(t, boxes)
    found, _ = derive(tr, times, cfg, 20.0)
    queues = [e for e in found if e.kind == "queue"]
    assert len(queues) == 1 and queues[0].meta["max_people"] == 2, queues
    assert not [e for e in found if e.kind == "pass"], [(e.kind, e.meta) for e in found]


def test_fast_walker_two_frames_counts():
    # Біля самої камери людина проскакує за два кадри — це перехожий, якщо
    # рамка ні в чиїй не сидить.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(10)]
    for t in times:
        tr.update(t, [box(700 + 100 * t, 300, w=300)] if 1.0 <= t <= 1.5 else [])
    found, _ = derive(tr, times, cfg, 5.0)
    assert [e.kind for e in found] == ["pass"], [e.kind for e in found]


def test_open_edges_marked():
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        tr.update(t, [box(500, 700)])  # стоїть увесь сегмент
    found, passages = derive(tr, times, cfg, 10.0)
    app = next(e for e in found if e.kind == "approach")
    assert app.open_start and app.open_end, "подія на весь сегмент має шви з обох боків"
    assert passages[0].open_start and passages[0].open_end


def test_every_event_has_evidence_moments():
    # Аркуш-доказ зберігається для всіх подій, тож три миті (початок, пік,
    # кінець) мусить знати кожна, а подія людини — ще й свій прохід.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(40)]
    for t in times:
        boxes = [box(400, 700)] if 2.0 <= t <= 12.0 else []
        if 4.0 <= t <= 9.0:
            boxes.append(box(700, 750))
        if 14.0 <= t <= 16.0:
            boxes.append(box(100 + 100 * (t - 14), 300))
        tr.update(t, boxes)
    found, _ = derive(tr, times, cfg, 20.0)
    by = {e.kind: e for e in found}
    assert set(by) == {"approach", "queue", "pass"}, [e.kind for e in found]
    assert all(len(e.moments) == 3 for e in found)
    assert by["approach"].passage is not None and by["pass"].passage is not None
    assert by["queue"].passage is None
    a, peak, b = by["approach"].moments
    assert a <= peak <= b


def test_mirror_is_not_a_person():
    # Відображення в дзеркалі (маска сцени) — ні проходу, ні події.
    cfg = config.load()
    scene = Scene(zone=ZONE, masks=[{"name": "mirror", "rect": [0.5, 0.0, 0.7, 0.45], "share": 0.6}])
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        tr.update(t, [box(600, 300, w=80, h=200)])
    found, passages = derive(tr, times, cfg, 10.0, scene)
    assert not found and not passages, [e.kind for e in found]


def test_machine_needs_standing_at_it():
    # Біля автомата (рамка обрізана низом кадру, ліворуч) і майже нерухомо
    # 5 с — machine. Те саме, але правіше (холодильник) — лише approach.
    cfg = config.load()
    machine = {"x1_max": 0.34, "cut_y": 0.97, "max_move": 0.055, "min_s": 4.0}
    scene = Scene(zone=ZONE, machine=machine)
    for cx, want in ((250, True), (700, False)):
        tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
        times = [i * 0.5 for i in range(20)]
        for t in times:
            tr.update(t, [[cx - 150, 300, cx + 150, 990, 0.9]] if 1.0 <= t <= 6.0 else [])
        found, _ = derive(tr, times, cfg, 10.0, scene)
        kinds = [e.kind for e in found]
        assert ("machine" in kinds) == want and "approach" in kinds, (cx, kinds)


def test_direction_and_heading():
    # Ноги від низу кадру вгору — людина йде від камери вглиб: на kyiv-01 це
    # «зайшла в зал». Навпаки — «вийшла».
    cfg = config.load()
    scene = Scene(zone=ZONE, heading={"away": "in", "toward": "out"})
    for ys, d, h in (((0.95, 0.35), "away", "in"), ((0.35, 0.95), "toward", "out")):
        tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
        times = [i * 0.5 for i in range(12)]
        for i, t in enumerate(times):
            y = (ys[0] + (ys[1] - ys[0]) * i / (len(times) - 1)) * H
            tr.update(t, [[450, y - 300, 550, y, 0.9]])
        _, passages = derive(tr, times, cfg, 6.0, scene)
        assert len(passages) == 1 and passages[0].direction == d, [p.direction for p in passages]
        assert passages[0].heading == h


def test_broken_track_is_one_passage():
    # Детектор загубив людину на 2 с (перекрили) — трекер дав два треки, а
    # прохід один: там само продовжилась, через секунди.
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(30)]
    for t in times:
        if t <= 4.0 or 6.5 <= t <= 10.0:
            tr.update(t, [box(200 + 20 * t, 300)])
        else:
            tr.update(t, [])
    found, passages = derive(tr, times, cfg, 15.0)
    assert len(passages) == 1 and len(passages[0].tracks) == 2, [p.tracks for p in passages]
    assert [e.kind for e in found] == ["pass"]


def test_reid_blocks_average_per_model():
    # Вектор проходу — блоки моделей, кожен нормований, разом довжина 1;
    # злиття половинок зважене.
    rng = np.random.default_rng(1)
    v = rng.normal(size=(4, 3, 256)).astype(np.float32)
    v /= np.linalg.norm(v, axis=2, keepdims=True)
    v = v.reshape(4, 768)
    m, w = rd.mean_vec(v, [1, 1, 1, 1])
    assert abs(np.linalg.norm(m) - 1) < 1e-5 and w == 4
    a, wa = rd.mean_vec(v[:2], [1, 1])
    b, wb = rd.mean_vec(v[2:], [1, 1])
    mm, _ = rd.merge(a, wa, b, wb)
    assert float(mm @ m) > 0.99, float(mm @ m)


def test_crops_pick_spread_in_time():
    cand = [(t * 0.5, 1.0 if t % 3 == 0 else 0.5, None, True) for t in range(40)]
    got = cr.pick(cand, 8)
    assert len(got) == 8 and got[0][0] < 3 and got[-1][0] > 16, [c[0] for c in got]


T0 = datetime(2026, 10, 10, 20, 0, tzinfo=timezone.utc)


class FakeP:
    def __init__(self, i, minute, secs, heading, direction="away", emb=None, camera="cam1"):
        self.id = i
        self.camera = camera
        self.t0 = T0 + timedelta(minutes=minute)
        self.t1 = self.t0 + timedelta(seconds=secs)
        self.heading = heading
        self.direction = direction
        self.emb = emb
        self.person = None


def test_visit_crosses_midnight_and_breaks():
    # Клуб цілодобовий: зайшов о 23:00, вийшов о 03:00 — один візит. Перекур
    # на 20 хв візит не рве, повернення через 2 год — новий візит.
    seq = [FakeP(1, 0, 3, "in"), FakeP(2, 120, 3, "out"), FakeP(3, 140, 3, "in"),
           FakeP(4, 240, 3, "out"), FakeP(5, 360, 3, "in")]
    v = people.visits(seq, lambda c, d: None, 45.0)
    assert len(v) == 2, v
    assert v[0][0] == seq[0].t0 and v[0][1] == seq[3].t1 and v[0][2] == 4
    assert v[1][0] == seq[4].t0 and v[1][1] is None


def test_cluster_respects_time_and_span():
    cfg = config.load()
    e = np.zeros(768, np.float32)
    e[0] = 1.0
    # Двоє однаково вдягнених одночасно в кадрі — різні люди; той самий одяг
    # через добу — теж різні (person_span_h).
    a, b = FakeP(1, 0, 30, "in", emb=e), FakeP(2, 0, 30, "in", emb=e)
    c = FakeP(3, 60, 5, "out", emb=e)
    d = FakeP(4, 60 * 24, 5, "out", emb=e)
    groups = people.cluster([[a], [b], [c], [d]], [False] * 4, cfg)
    sizes = sorted(len(g) for g in groups)
    assert sizes == [1, 1, 2], [[p.id for p in g] for g in groups]
    # Дві вже відомі людини (насіння) не зливаються.
    groups = people.cluster([[a], [c]], [True, True], cfg)
    assert len(groups) == 2


def test_scene_lookup():
    cfg = config.load({"SCENES_JSON": '{"default": {"zone": [[0,0.9],[1,0.9],[1,1],[0,1]]}, '
                                      '"kyiv-01": {"machine": {"x1_max": 0.3}}, '
                                      '"kyiv-01:cam2": {"machine": null}}'})
    assert cfg.scene_for("kyiv-01", "cam1").machine == {"x1_max": 0.3}
    assert cfg.scene_for("kyiv-01", "cam1").zone[0] == [0, 0.9]
    assert cfg.scene_for("kyiv-01", "cam2").machine is None
    assert cfg.scene_for("lviv-01", "cam1").masks == []


def test_load_keeps_class_defaults():
    # load() колись мав свою копію значень, і вона перемагала клас.
    d, cfg = config.Config(), config.load({})
    assert cfg.motion_min_fraction == d.motion_min_fraction
    assert cfg.approach_min_s == d.approach_min_s
    assert config.load({"APPROACH_MIN_S": "7"}).approach_min_s == 7.0


def test_prod_ignores_dev_r2():
    # У прод-.env лежать і R2_DEV_* від локального MinIO — прод їх не бере.
    env = {"R2_DEV_ENDPOINT": "http://127.0.0.1:9100", "R2_ENDPOINT": "https://r2"}
    assert config.load({**env, "APP_ENV": "production"}).r2_endpoint == "https://r2"
    assert config.load(env).r2_endpoint == "http://127.0.0.1:9100"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"✓ {fn.__name__}")
    print(f"{len(tests)} перевірок пройдено")
