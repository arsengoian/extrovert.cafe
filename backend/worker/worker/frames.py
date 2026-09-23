"""Декодування: ffprobe + два проходи ffmpeg із docs/video.md.

Транскодування немає ніде: на точці ffmpeg робить remux (`-c copy`), тут ми
лише вибірково ДЕКОДУЄМО окремі кадри й віддаємо їх у модель масивом numpy.
Кадри не пишуться на диск — вони йдуть по пайпу, бо на 50 ГБ диска
тримати розпаковане відео немає ні місця, ні потреби.
"""
import json
import subprocess
from dataclasses import dataclass

import numpy as np


@dataclass
class Probe:
    width: int
    height: int
    duration_s: float
    fps: float


def probe(path: str) -> Probe:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate:format=duration",
         "-of", "json", path],
        capture_output=True, check=True, text=True).stdout
    data = json.loads(out)
    st = data["streams"][0]
    num, _, den = st.get("avg_frame_rate", "0/1").partition("/")
    fps = float(num) / float(den) if float(den or 0) else 0.0
    # У TS-сегмента, обрізаного живленням, format.duration може бути відсутня.
    dur = float(data.get("format", {}).get("duration") or 0.0)
    return Probe(int(st["width"]), int(st["height"]), dur, fps)


def _run(args: list[str], width: int, height: int, channels: int):
    """Читає rawvideo з stdout ffmpeg кадр за кадром."""
    size = width * height * channels
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            shape = (height, width) if channels == 1 else (height, width, channels)
            yield np.frombuffer(buf, dtype=np.uint8).reshape(shape)
    finally:
        proc.stdout.close()
        proc.wait()


def _scaled(p: Probe, width: int) -> tuple[int, int]:
    w = min(width, p.width)
    # Висоту рахуємо самі й передаємо ffmpeg явно. З scale=w:-2 округлення
    # лишалось би на боці ffmpeg, а ми читаємо сирий буфер по w*h*3 байти:
    # розбіжність в один рядок — і кадри поїхали б по діагоналі.
    h = int(round(p.height * w / p.width / 2)) * 2
    return w, h


def keyframes(path: str, p: Probe, width: int = 160):
    """Перший прохід: лише ключові кадри, сірим, дрібно. Дешевий гейт."""
    w, h = _scaled(p, width)
    args = ["ffmpeg", "-nostdin", "-loglevel", "error", "-skip_frame", "nokey",
            "-i", path, "-an", "-vf", f"scale={w}:{h},format=gray",
            "-vsync", "0", "-f", "rawvideo", "-"]
    yield from _run(args, w, h, 1)


def motion_score(path: str, p: Probe, delta: int) -> float:
    """Найбільша частка кадру, що змінилась між сусідніми ключовими кадрами."""
    prev = None
    best = 0.0
    for frame in keyframes(path, p):
        if prev is not None:
            diff = np.abs(frame.astype(np.int16) - prev.astype(np.int16))
            best = max(best, float((diff > delta).mean()))
        prev = frame
    return best


def sampled(path: str, p: Probe, fps: float, width: int):
    """Другий прохід: повний декод із семплінгом. Віддає (offset_s, rgb)."""
    w, h = _scaled(p, width)
    args = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-an",
            "-vf", f"fps={fps},scale={w}:{h}", "-vsync", "0",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    for i, frame in enumerate(_run(args, w, h, 3)):
        yield i / fps, frame


def clip(src: str, dst: str, start_s: float, duration_s: float) -> None:
    """Кліп-доказ. Знову без перекодування: ріжемо по ключових кадрах."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y",
         "-ss", f"{max(0.0, start_s):.3f}", "-i", src,
         "-t", f"{duration_s:.3f}", "-c", "copy",
         "-avoid_negative_ts", "make_zero", dst],
        check=True)


def still(path: str, at_s: float, width: int = 960) -> bytes:
    """Один кадр у JPEG — доказ для адмінки.

    Дістаємо окремим запуском ffmpeg, а не тримаємо кадри в памʼяті весь
    прохід: доказ потрібен для одиниць подій із сотні кадрів, і зайвий
    seek дешевший за мегабайти RGB, які довелось би возити з собою.
    """
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error",
         "-ss", f"{max(0.0, at_s):.3f}", "-i", path, "-frames:v", "1",
         "-vf", f"scale='min({width},iw)':-2", "-q:v", "4", "-f", "mjpeg", "-"],
        capture_output=True, check=True).stdout
    return out
