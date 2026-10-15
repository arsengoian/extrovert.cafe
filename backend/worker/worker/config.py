"""Налаштування воркера — усе з оточення, нічого з коду.

Пороги винесені сюди не заради гнучкості, а тому що їх доведеться крутити
за живим відео з точки: висота камери, кут і ширина кадру в нас поки що
тільки на папері (`docs/video.md`), і перші тижні значення будуть іншими.

Те, що залежить від конкретної камери (зона кавʼярні, маски, де автомат,
куди веде коридор), — не тут, а в сцені (`scenes.json`, `scene_for`): той
самий код обробляє відео з будь-якої точки, а сцена приходить разом із
сегментом за його `point_id`/`camera_id`.
"""
import json
import os
from dataclasses import dataclass, field

DEFAULT_ZONE = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]

# Версія аналізу. Сегменти, оброблені меншою, воркер переробляє сам, коли
# свіжих у черзі немає (db.claim). 1 — події без проходів (до 15.10.2026),
# 2 — проходи, напрямок, автомат, вирізки, вектори зовнішності.
ANALYSIS_VERSION = 2


def _f(env, name: str, default: float) -> float:
    return float(env.get(name, default))


def _i(env, name: str, default: int) -> int:
    return int(env.get(name, default))


@dataclass
class Scene:
    """Що залежить від того, де висить камера (scenes.json)."""
    zone: list = field(default_factory=lambda: DEFAULT_ZONE)
    masks: list = field(default_factory=list)
    machine: dict | None = None
    heading: dict = field(default_factory=dict)

    def heading_of(self, direction: str) -> str | None:
        return (self.heading or {}).get(direction)


@dataclass
class Config:
    # ── черга й база ────────────────────────────────────────────────────
    database_url: str = ""
    poll_s: float = 5.0
    lock_stale_min: int = 15
    max_attempts: int = 5
    # Переробляти старі сегменти новою версією аналізу, коли свіжих немає.
    reprocess: bool = True

    # ── R2 ──────────────────────────────────────────────────────────────
    app_env: str = "local"
    r2_endpoint: str = ""
    r2_key: str = ""
    r2_secret: str = ""
    r2_region: str = "auto"
    evidence_clips: bool = False

    # ── декодування ─────────────────────────────────────────────────────
    # 2 кадри в секунду — компроміс із docs/video.md: 15 fps не влазять в
    # одне ядро навіть для однієї камери, 1 fps губить короткий підхід.
    sample_fps: float = 2.0
    # Ширина кадру для моделі. Декодуємо вдвічі ширше (crop_width) і
    # зменшуємо середнім 2×2: модель бачить те саме, що й раніше, а вирізки
    # людей і доказ беруться з повного кадру — для впізнавання за одягом
    # пікселі потрібні (аналіз архіву 09–14.10).
    decode_width: int = 640
    crop_width: int = 1280
    # Гейт по руху: спершу дивимось лише ключові кадри (їх ~0,4 на секунду).
    # Сегмент без руху далі не йде взагалі — саме це дає 20 тис. кадрів на
    # добу замість 173 тис.
    motion_gate: bool = True
    motion_pixel_delta: int = 14      # яскравість, за якою піксель «змінився»
    # 1 %, а не 0,2 %: заміряно на 29 сегментах із нашої камери (11.10.2026).
    # Порожні сегменти дають 0,000–0,024, а найтихіший сегмент із живою
    # людиною — 0,058, тож між ними лишається пʼятикратний запас. На 0,002
    # повний розбір проходили пʼять сегментів, де нікого не було: чверть
    # усього процесорного часу згоріла на порожнечу.
    motion_min_fraction: float = 0.01

    # ── детекція ────────────────────────────────────────────────────────
    model_path: str = "/app/models/model.onnx"
    conf: float = 0.35
    nms_iou: float = 0.45
    min_box_h: float = 0.08   # частка висоти кадру; менше — це не людина

    # ── трекінг і події ─────────────────────────────────────────────────
    track_max_age_s: float = 1.5
    track_min_score: float = 0.2
    # 4 с у зоні впритул (scenes.json). Заміряно 12.10.2026 на 29 сегментах:
    # люди біля кавʼярні стоять там від 19 до 62 с, а перехожі, що йдуть
    # повз саму камеру в коридор, потрапляють у зону максимум на 2,5 с. Чотири
    # секунди — півтора запасу над найдовшим перехожим і все ще досить мало,
    # щоб порахувати того, хто лише прочитав меню.
    approach_min_s: float = 4.0
    queue_min_s: float = 3.0
    queue_min_people: int = 2
    # Хто рахується перехожим (events.is_person): один кадр — шум; два —
    # лише якщо рамка стоїть окремо (у чужій менше ніж на 30 %); від трьох —
    # якщо в чужій рамці менше ніж на 60 %. Заміри — там само.
    pass_min_frames: int = 2
    fragment_cover: float = 0.3
    shadow_cover: float = 0.6
    stitch_gap_s: float = 2.0  # шов між сегментами: див. events.py

    # ── проходи (worker/passages.py) ────────────────────────────────────
    # Трек, що почався за кілька секунд після кінця іншого там само, де той
    # обірвався, і не надто несхожий на нього, — та сама людина: детектор
    # губить людину на 1–4 с, коли її перекриває інша чи вона під камерою.
    join_gap_s: float = 4.0
    join_dist: float = 0.18
    join_sim: float = 0.30
    # Зміщення глибини (низ рамки), з якого прохід має напрямок.
    move_depth: float = 0.12
    crops_per_passage: int = 8
    crop_max_h: int = 256

    # ── впізнавання (worker/reid.py, worker/people.py) ──────────────────
    # Три моделі Intel разом: пороги нижче підібрані саме на їхньому
    # середньому (аналіз архіву 09–14.10), з однією 0277 шкала схожості інша.
    reid_dir: str = "/app/models/reid"
    reid_models: tuple = ("0277", "0286", "0287")
    # Поріг злиття проходів в одну людину: на ручній розмітці 66 пар з
    # архіву вище 0,55 — 95 % справді та сама людина (docs/video.md).
    people_thr: float = 0.55
    # Добирання «вхід без виходу ↔ вихід без входу»: вище 0,44 перевірені пари
    # правильні 5 з 5, нижче — хибні 6 з 6.
    link_thr: float = 0.44
    # Персонал: стільки проходів за добу гість не робить (адміністратор —
    # 50–80 за зміну); схожі на нього дрібні кластери доливаються до нього.
    staff_passes: int = 12
    staff_absorb: float = 0.45
    # Людина — не довше 18 год: далі одяг уже не тримає ідентичність, а
    # клуб цілодобовий, тож нічний візит має перетинати північ.
    person_span_h: float = 18.0
    # Перерва (перекур, по їжу) до 45 хв візит не рве.
    visit_break_min: float = 45.0
    # Перерахунок людей — за останні 72 год, раз на 10 хв, коли черга
    # порожня; старші люди заморожені.
    people_window_h: float = 72.0
    people_every_s: float = 600.0
    near_min_depth: float = 0.7   # хто не підходив ближче — ідентичності не дає
    min_crops: int = 2

    scenes: dict = field(default_factory=dict)

    def scene_for(self, point_id: str, camera_id: str) -> Scene:
        """Сцена камери: '<point>:<camera>' → '<point>' → 'default', поверх 'default'."""
        base = dict(self.scenes.get("default") or {})
        own = (self.scenes.get(f"{point_id}:{camera_id}")
               or self.scenes.get(point_id) or {})
        base.update(own)
        return Scene(
            zone=base.get("zone") or DEFAULT_ZONE,
            masks=base.get("masks") or [],
            machine=base.get("machine"),
            heading=base.get("heading") or {},
        )


def load(env: dict | None = None) -> Config:
    env = os.environ if env is None else env
    # Запасні значення — з полів класу, а не другою копією тут: дві копії
    # уже розʼїхались (гейт 0,002 тут проти 0,01 у класі), і перемагала стара.
    d = Config()
    scenes = {}
    path = env.get("SCENES_PATH")
    if path and os.path.exists(path):
        scenes = json.loads(open(path, encoding="utf-8").read())
    elif env.get("SCENES_JSON"):
        scenes = json.loads(env["SCENES_JSON"])

    app_env = env.get("APP_ENV", "local")
    # R2_DEV_* — лише поза продом, як у backend/lib/src/r2.js (r2Config).
    # У прод-.env ці ключі теж є (env-prod.mjs тримає набір як у
    # .env.example), поки що порожні; варто одному заповнитись — і без цієї
    # перевірки воркер на проді пішов би по сегменти в локальний MinIO.
    dev = app_env != "production"

    def r2(name):
        return (dev and env.get(f"R2_DEV_{name}")) or env.get(f"R2_{name}", "")

    return Config(
        database_url=env.get("DATABASE_URL", ""),
        poll_s=_f(env, "POLL_S", d.poll_s),
        lock_stale_min=_i(env, "LOCK_STALE_MIN", d.lock_stale_min),
        max_attempts=_i(env, "MAX_ATTEMPTS", d.max_attempts),
        reprocess=env.get("REPROCESS", "1") == "1",
        app_env=app_env,
        r2_endpoint=r2("ENDPOINT"),
        r2_key=r2("ACCESS_KEY_ID"),
        r2_secret=r2("SECRET_ACCESS_KEY"),
        r2_region=env.get("R2_REGION", "auto"),
        evidence_clips=env.get("EVIDENCE_CLIPS", "0") == "1",
        sample_fps=_f(env, "SAMPLE_FPS", d.sample_fps),
        decode_width=_i(env, "DECODE_WIDTH", d.decode_width),
        crop_width=_i(env, "CROP_WIDTH", d.crop_width),
        motion_gate=env.get("MOTION_GATE", "1") == "1",
        motion_pixel_delta=_i(env, "MOTION_PIXEL_DELTA", d.motion_pixel_delta),
        motion_min_fraction=_f(env, "MOTION_MIN_FRACTION", d.motion_min_fraction),
        model_path=env.get("MODEL_PATH", d.model_path),
        conf=_f(env, "CONF", d.conf),
        nms_iou=_f(env, "NMS_IOU", d.nms_iou),
        min_box_h=_f(env, "MIN_BOX_H", d.min_box_h),
        track_max_age_s=_f(env, "TRACK_MAX_AGE_S", d.track_max_age_s),
        track_min_score=_f(env, "TRACK_MIN_SCORE", d.track_min_score),
        approach_min_s=_f(env, "APPROACH_MIN_S", d.approach_min_s),
        queue_min_s=_f(env, "QUEUE_MIN_S", d.queue_min_s),
        queue_min_people=_i(env, "QUEUE_MIN_PEOPLE", d.queue_min_people),
        pass_min_frames=_i(env, "PASS_MIN_FRAMES", d.pass_min_frames),
        fragment_cover=_f(env, "FRAGMENT_COVER", d.fragment_cover),
        shadow_cover=_f(env, "SHADOW_COVER", d.shadow_cover),
        stitch_gap_s=_f(env, "STITCH_GAP_S", d.stitch_gap_s),
        reid_dir=env.get("REID_DIR", d.reid_dir),
        reid_models=tuple(m for m in env.get("REID_MODELS", ",".join(d.reid_models)).split(",") if m),
        people_thr=_f(env, "PEOPLE_THR", d.people_thr),
        link_thr=_f(env, "LINK_THR", d.link_thr),
        staff_passes=_i(env, "STAFF_PASSES", d.staff_passes),
        people_every_s=_f(env, "PEOPLE_EVERY_S", d.people_every_s),
        scenes=scenes,
    )
