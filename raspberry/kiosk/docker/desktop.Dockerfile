# Білдер для `make desktop` — НЕ образ для деплою, тут нічого не COPY'їться.
# Джерело монтується живим томом (docker/build.sh), тому правка коду не
# вимагає перезбирати образ — лише сам make всередині контейнера.
#
# Навіщо Docker, а не системний MSYS2/gcc на Windows: залежності тут — ті
# самі apt-пакети, що на реальному дев-боксі Linux (і концептуально близькі
# до того, що ставиться на Pi через libcairo2-dev тощо, хоч Pi — Stretch,
# а тут сучасний Debian). Не займає системний PATH/реєстр хостової машини.
#
# EGL/GLESv2 тут — системний Mesa (llvmpipe, софтверний рендер): те саме,
# чим підтверджувався platform_desktop.c локально (docs/roadmap.md,
# "Локально підтверджено"), тепер відтворювано в контейнері.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config \
        libcairo2-dev libpango1.0-dev librsvg2-dev \
        libcurl4-openssl-dev libpng-dev libfontconfig1-dev \
        libgles2-mesa-dev libegl1-mesa-dev \
        ca-certificates \
        python3 \
    && rm -rf /var/lib/apt/lists/*
# python3 — не залежність кіоска, лише щоб піднімати
# `python3 -m http.server` тут-таки для смок-тестів проти реального
# HTTP (пряме menu_poll() з file:// не працює: file:// не несе HTTP-код,
# а menu_poll вимагає 200..299).

WORKDIR /work
