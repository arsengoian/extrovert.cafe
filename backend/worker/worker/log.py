"""Лог у stdout одним рядком на подію.

Докер збирає stdout, journald його обертає, glitchtip ловить помилки —
свого файлового логу воркеру не треба. Формат людський, а не JSON: цей лог
читає людина, коли черга відстала, а не парсер.
"""
import sys
import time


def _line(level: str, msg: str, **kv: object) -> None:
    ts = time.strftime("%H:%M:%S", time.localtime())
    tail = " ".join(f"{k}={v}" for k, v in kv.items() if v is not None)
    print(f"{ts} {level} {msg}{' ' + tail if tail else ''}", file=sys.stdout, flush=True)


def info(msg: str, **kv: object) -> None:
    _line("·", msg, **kv)


def warn(msg: str, **kv: object) -> None:
    _line("!", msg, **kv)


def error(msg: str, **kv: object) -> None:
    _line("✗", msg, **kv)
