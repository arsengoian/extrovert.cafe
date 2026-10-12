"""Перевірка логіки, яку не видно на відео: трек, зона, межі подій.

Без pytest і без моделі — голі assert, щоб запускалось у тому ж образі, що
й воркер: `python -m tests.test_logic`. Логіка тут рівно та, через яку
проходить кожен сегмент, і помилка в ній не впаде, а тихо зіпсує
статистику — саме такі й ловлять тестом.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker import config, events as ev  # noqa: E402
from worker.track import Tracker, affinity  # noqa: E402

W = H = 1000
ZONE = [[0.0, 0.5], [1.0, 0.5], [1.0, 1.0], [0.0, 1.0]]  # нижня половина кадру


def box(cx, cy, w=100, h=200):
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 0.9]


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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 20.0)
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 10.0)
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 15.0)
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 10.0)
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 20.0)
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 5.0)
    assert [e.kind for e in found] == ["pass"], [e.kind for e in found]


def test_open_edges_marked():
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        tr.update(t, [box(500, 700)])  # стоїть увесь сегмент
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 10.0)
    app = next(e for e in found if e.kind == "approach")
    assert app.open_start and app.open_end, "подія на весь сегмент має шви з обох боків"


def test_every_event_has_evidence_frame():
    # Доказ зберігається для всіх подій, тож кадр мусить знати кожна: підхід і
    # перехожий — з рамкою людини, черга — з усіма, хто стояв.
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
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 20.0)
    by = {e.kind: e for e in found}
    assert set(by) == {"approach", "queue", "pass"}, [e.kind for e in found]
    assert all(e.best is not None for e in found)
    at, boxes = by["approach"].best
    assert len(boxes) == 1 and all(0.0 <= v <= 1.0 for v in boxes[0]), boxes
    assert len(by["queue"].best[1]) == 2
    assert len(by["pass"].best[1]) == 1


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
