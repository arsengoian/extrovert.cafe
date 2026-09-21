# Білдер ARM-бінарника для Pi 1 — на ПК, а не на малині.
#
# Малина в коридорі має малювати меню, а не компілювати: `make pi` на ній
# з'їдає ~80 с при 100 % CPU, і рівно стільки кіоск смикається. Тому збираємо
# тут, а на точку їде готовий архів (docs/raspberry-pi.md §3).
#
# Образ — Raspbian Stretch під armv6, той самий, що на пристрої: glibc 2.24,
# gcc 6.3. Це важливіше за швидкість збірки: бінарник, злінкований із
# новішою glibc, на Stretch просто не запуститься. На x86 образ крутиться
# через QEMU (binfmt у Docker Desktop) — повільно, але це наш процесор.
#
# Джерела пакетів: Stretch давно поїхав з archive.raspbian.org (там 404 і
# немає Release), робочий дзеркальний — legacy.raspbian.org. Заголовки
# VideoCore (/opt/vc/include) дає libraspberrypi-dev з репозиторію
# raspberrypi.org; самі бібліотеки в образі вже лежать.
FROM balenalib/rpi-raspbian:stretch

RUN printf '%s\n' \
      "deb http://legacy.raspbian.org/raspbian stretch main contrib non-free rpi firmware" \
      "deb http://legacy.raspberrypi.org/debian stretch main" \
      > /etc/apt/sources.list \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99no-check-valid \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential pkg-config \
        libcairo2-dev libpango1.0-dev librsvg2-dev \
        libcurl4-openssl-dev libpng-dev libfontconfig1-dev \
        libraspberrypi-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
