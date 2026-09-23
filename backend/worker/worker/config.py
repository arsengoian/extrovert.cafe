"""Налаштування воркера — усе з оточення, нічого з коду.

Пороги винесені сюди не заради гнучкості, а тому що їх доведеться крутити
за живим відео з точки: висота камери, кут і ширина кадру в нас поки що
тільки на папері (`docs/video.md`), і перші тижні значення будуть іншими.
"""
import json
import os
from dataclasses import dataclass, field

DEFAULT_ZONE = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]


def _f(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _i(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


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
    motion_min_fraction: float = 0.002  # 0,2 % кадру — вже рух, менше — шум

    # ── детекція ────────────────────────────────────────────────────────
    model_path: str = "/app/models/model.onnx"
    conf: float = 0.35
    nms_iou: float = 0.45
    min_box_h: float = 0.08   # частка висоти кадру; менше — це не людина

    # ── трекінг і події ─────────────────────────────────────────────────
    track_max_age_s: float = 1.5
    track_min_score: float = 0.2
    approach_min_s: float = 1.5
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
    zones = {}
    path = env.get("ZONES_PATH")
    if path and os.path.exists(path):
        zones = json.loads(open(path, encoding="utf-8").read())
    elif env.get("ZONES_JSON"):
        zones = json.loads(env["ZONES_JSON"])

    return Config(
        database_url=env.get("DATABASE_URL", ""),
        poll_s=_f("POLL_S", 5.0),
        lock_stale_min=_i("LOCK_STALE_MIN", 15),
        max_attempts=_i("MAX_ATTEMPTS", 5),
        app_env=env.get("APP_ENV", "local"),
        r2_endpoint=env.get("R2_DEV_ENDPOINT") or env.get("R2_ENDPOINT", ""),
        r2_key=env.get("R2_DEV_ACCESS_KEY_ID") or env.get("R2_ACCESS_KEY_ID", ""),
        r2_secret=env.get("R2_DEV_SECRET_ACCESS_KEY") or env.get("R2_SECRET_ACCESS_KEY", ""),
        r2_region=env.get("R2_REGION", "auto"),
        evidence_clips=env.get("EVIDENCE_CLIPS", "0") == "1",
        sample_fps=_f("SAMPLE_FPS", 2.0),
        decode_width=_i("DECODE_WIDTH", 640),
        motion_gate=env.get("MOTION_GATE", "1") == "1",
        motion_pixel_delta=_i("MOTION_PIXEL_DELTA", 14),
        motion_min_fraction=_f("MOTION_MIN_FRACTION", 0.002),
        model_path=env.get("MODEL_PATH", "/app/models/model.onnx"),
        conf=_f("CONF", 0.35),
        nms_iou=_f("NMS_IOU", 0.45),
        min_box_h=_f("MIN_BOX_H", 0.08),
        track_max_age_s=_f("TRACK_MAX_AGE_S", 1.5),
        track_min_score=_f("TRACK_MIN_SCORE", 0.2),
        approach_min_s=_f("APPROACH_MIN_S", 1.5),
        queue_min_s=_f("QUEUE_MIN_S", 3.0),
        queue_min_people=_i("QUEUE_MIN_PEOPLE", 2),
        idle_min_s=_f("IDLE_MIN_S", 45.0),
        stitch_gap_s=_f("STITCH_GAP_S", 2.0),
        zones=zones,
    )
