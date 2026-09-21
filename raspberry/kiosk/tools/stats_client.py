#!/usr/bin/env python3
"""Запит телеметрії pos-native через UNIX-сокет.

Сокет — request/response: підключився, отримав один рядок JSON, зʼєднання
закрилось. Той самий принцип, яким раніше знімався fps з Chromium через
Chrome DevTools Protocol (pi/README.md, замір 17.08.2026), тільки без
браузера й без ssh-тунелю — процес сам публікує свою статистику.

Використання:
  python3 tools/stats_client.py [шлях-до-сокета] [--watch [інтервал_с]]
"""
import json
import socket
import sys
import time

def query(path):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect(path)
    data = s.recv(65536)
    s.close()
    return json.loads(data.decode())

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else "/tmp/pos-native.sock"
    watch = "--watch" in sys.argv
    interval = float(args[1]) if watch and len(args) > 1 else 1.0

    if not watch:
        print(json.dumps(query(path), ensure_ascii=False, indent=2))
        return

    print("ts        fps_1s  fps_avg  worst_ms  frames")
    try:
        while True:
            d = query(path)
            print("%8.1f  %6.1f  %7.1f  %8.1f  %d" % (
                time.time(), d["fps_1s"], d["fps_avg"],
                d["frame_ms_worst"], d["frames_total"]))
            time.sleep(interval)
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
