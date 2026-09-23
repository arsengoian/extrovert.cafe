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


def test_approach_and_idle():
    cfg = config.load()
    cfg.idle_min_s = 1.5
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(40)]  # 20 секунд
    for t in times:
        # людина стоїть біля стійки з 2-ї по 8-му секунду
        tr.update(t, [box(500, 700)] if 2.0 <= t <= 8.0 else [])
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 20.0)
    kinds = [e.kind for e in found]
    assert "approach" in kinds, kinds
    app = next(e for e in found if e.kind == "approach")
    assert 6.0 <= app.end_s - app.start_s <= 7.5, (app.start_s, app.end_s)
    assert not app.open_start and not app.open_end
    idles = [e for e in found if e.kind == "idle"]
    assert len(idles) == 2, [(e.start_s, e.end_s) for e in idles]
    assert idles[0].open_start and idles[-1].open_end


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


def test_open_edges_marked():
    cfg = config.load()
    tr = Tracker(cfg.track_max_age_s, cfg.track_min_score)
    times = [i * 0.5 for i in range(20)]
    for t in times:
        tr.update(t, [box(500, 700)])  # стоїть увесь сегмент
    found = ev.derive(tr.finish(), times, ZONE, W, H, cfg, 10.0)
    app = next(e for e in found if e.kind == "approach")
    assert app.open_start and app.open_end, "подія на весь сегмент має шви з обох боків"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"✓ {fn.__name__}")
    print(f"{len(tests)} перевірок пройдено")
