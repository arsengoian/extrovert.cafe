"""Налаштування воркера — усе з оточення, нічого з коду.

Пороги винесені сюди не заради гнучкості, а тому що їх доведеться крутити
за живим відео з точки: висота камери, кут і ширина кадру в нас поки що
тільки на папері (`docs/video.md`), і перші тижні значення будуть іншими.
"""
import json
import os
from dataclasses import dataclass, field

DEFAULT_ZONE = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]


def _f(env, name: str, default: float) -> float:
    return float(env.get(name, default))


def _i(env, name: str, default: int) -> int:
    return int(env.get(name, default))


@dataclass
class Config:
    # ── черга й база ────────────────────────────────────────────────────
    database_url: str = ""
    poll_s: float = 5.0
    lock_stale_min: int = 15
    max_attempts: int = 5

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
    decode_width: int = 640
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
    # 4 с у зоні впритул (zones.json). Заміряно 12.10.2026 на 29 сегментах:
    # люди біля кавʼярні стоять там від 19 до 62 с, а перехожі, що йдуть
    # повз саму камеру в коридор, потрапляють у зону максимум на 2,5 с. Чотири
    # секунди — півтора запасу над найдовшим перехожим і все ще досить мало,
    # щоб порахувати того, хто лише прочитав меню.
    approach_min_s: float = 4.0
    queue_min_s: float = 3.0
    queue_min_people: int = 2
    idle_min_s: float = 45.0
    stitch_gap_s: float = 2.0  # шов між сегментами: див. events.py

    zones: dict = field(default_factory=dict)

    def zone_for(self, point_id: str, camera_id: str) -> list:
        """Полігон стійки в частках кадру. Немає — вважаємо зоною весь кадр."""
        return (
            self.zones.get(f"{point_id}:{camera_id}")
            or self.zones.get(point_id)
            or self.zones.get("default")
            or DEFAULT_ZONE
        )


def load(env: dict | None = None) -> Config:
    env = os.environ if env is None else env
    # Запасні значення — з полів класу, а не другою копією тут: дві копії
    # уже розʼїхались (гейт 0,002 тут проти 0,01 у класі), і перемагала стара.
    d = Config()
    zones = {}
    path = env.get("ZONES_PATH")
    if path and os.path.exists(path):
        zones = json.loads(open(path, encoding="utf-8").read())
    elif env.get("ZONES_JSON"):
        zones = json.loads(env["ZONES_JSON"])

    app_env = env.get("APP_ENV", "local")
    # R2_DEV_* — лише поза продом, як у backend/lib/src/r2.js (r2Config).
    # У прод-.env вони теж лежать (локальний MinIO з .env.example), і без
    # цієї перевірки воркер на проді ходив би по сегменти на 127.0.0.1:9100.
    dev = app_env != "production"

    def r2(name):
        return (dev and env.get(f"R2_DEV_{name}")) or env.get(f"R2_{name}", "")

    return Config(
        database_url=env.get("DATABASE_URL", ""),
        poll_s=_f(env, "POLL_S", d.poll_s),
        lock_stale_min=_i(env, "LOCK_STALE_MIN", d.lock_stale_min),
        max_attempts=_i(env, "MAX_ATTEMPTS", d.max_attempts),
        app_env=app_env,
        r2_endpoint=r2("ENDPOINT"),
        r2_key=r2("ACCESS_KEY_ID"),
        r2_secret=r2("SECRET_ACCESS_KEY"),
        r2_region=env.get("R2_REGION", "auto"),
        evidence_clips=env.get("EVIDENCE_CLIPS", "0") == "1",
        sample_fps=_f(env, "SAMPLE_FPS", d.sample_fps),
        decode_width=_i(env, "DECODE_WIDTH", d.decode_width),
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
        idle_min_s=_f(env, "IDLE_MIN_S", d.idle_min_s),
        stitch_gap_s=_f(env, "STITCH_GAP_S", d.stitch_gap_s),
        zones=zones,
    )
