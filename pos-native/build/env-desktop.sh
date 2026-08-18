#!/usr/bin/env bash
# Джерело для локальної (desktop) збірки й запуску: pkg-config і рантайм-
# бібліотеки не встановлені системно (у пісочниці немає root), тому все
# стягнуте через `apt-get download` + `dpkg -x` у SYSROOT нижче — без
# встановлення в систему, без Docker, без sudo.
#
# Той самий приз без користі: EGL_PLATFORM_SURFACELESS_MESA дає реальний
# GLES2 (Mesa llvmpipe, софтверний растеризатор), тобто перевіряється
# КОРЕКТНІСТЬ малювання, шейдерів і мережі. FPS-числа з цього шляху НІЧОГО
# не кажуть про Pi 1 — там інший GPU і інший клас продуктивності. Це лише
# щоб побачити картинку й впевнитись, що логіка не падає, перш ніж везти
# на живе залізо.
#
# Використання: source build/env-desktop.sh
export POS_NATIVE_SYSROOT="${POS_NATIVE_SYSROOT:-/tmp/local-sysroot}"
export PKG_CONFIG_PATH="$POS_NATIVE_SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$POS_NATIVE_SYSROOT/usr/lib/pkgconfig:$POS_NATIVE_SYSROOT/usr/share/pkgconfig"
export PKG_CONFIG_SYSROOT_DIR="$POS_NATIVE_SYSROOT"
export C_INCLUDE_PATH="$POS_NATIVE_SYSROOT/usr/include:$POS_NATIVE_SYSROOT/usr/include/x86_64-linux-gnu"
export LIBRARY_PATH="$POS_NATIVE_SYSROOT/usr/lib/x86_64-linux-gnu"
export LD_LIBRARY_PATH="$POS_NATIVE_SYSROOT/usr/lib/x86_64-linux-gnu:$POS_NATIVE_SYSROOT/usr/lib"
export __EGL_VENDOR_LIBRARY_FILENAMES="$POS_NATIVE_SYSROOT/usr/share/glvnd/egl_vendor.d/50_mesa.json"
export LIBGL_ALWAYS_SOFTWARE=1
