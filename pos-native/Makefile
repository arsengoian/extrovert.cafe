# pos-native — дві цілі:
#   make desktop  — x86_64, для локальних тестів (EGL surfaceless + Mesa
#                   llvmpipe). Потребує `source build/env-desktop.sh` перед
#                   запуском, щоб pkg-config бачив /tmp/local-sysroot.
#   make pi       — НАТИВНА збірка НА самому Pi 1, не крос-компіляція.
#                   Малина сама має gcc 6.3 і glibc 2.24 (те, під що довелось
#                   би підганяти sysroot), тож простіше й надійніше поставити
#                   -dev пакети через apt і зібрати на місці, ніж мати справу
#                   з розбіжністю версій хедерів/символів крос-тулчейну.
#                   Один раз: `sudo apt-get install libcairo2-dev
#                   libpango1.0-dev librsvg2-dev libcurl4-openssl-dev
#                   libpng-dev libfontconfig1-dev libgles2-mesa-dev
#                   libegl1-mesa-dev libraspberrypi-dev` (libcjson-dev у
#                   Stretch немає — cJSON тому вендориться в third_party/).
#
# Джерела спільні для обох цілей; відрізняється лише platform_*.c і те,
# звідки беруться заголовки/бібліотеки.

CC ?= gcc
SRC_COMMON = src/main.c src/menu.c src/render.c src/gl.c src/telemetry.c \
             src/svgtpl.c src/qr.c src/bonus.c \
             third_party/cjson/cJSON.c third_party/qrcodegen/qrcodegen.c
CFLAGS_COMMON = -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -O2 -Isrc \
                -Ithird_party/cjson -Ithird_party/qrcodegen -pthread

# glesv2/egl тут ідуть окремо від решти пакетів: на десктопі це системний
# Mesa (потрібен для surfaceless-тесту), а на Pi — навпаки, GL/EGL мають бути
# Broadcom-ові (libbrcmEGL/libbrcmGLESv2 з /opt/vc/lib), не Mesa. Стретч на
# цій малині ставить генеричні libEGL.so/libGLESv2.so від Mesa в
# /usr/lib/arm-linux-gnueabihf (через *-mesa-dev, потрібні лише як залежність
# для заголовків) — pkg-config егл/glesv2 резолвиться саме туди. Якщо зібрати
# pos-native-pi проти них, eglInitialize намагається піднятись як X11-клієнт
# (DRI2/DRI3) замість dispmanx і падає — на цьому залізі нема навіть vc4/KMS
# (lsmod чистий), тож єдиний робочий шлях — лінкуватись напряму на
# /opt/vc/lib/libbrcmEGL.so /opt/vc/lib/libbrcmGLESv2.so, в обхід pkg-config.
PKGS_BASE = cairo pangocairo librsvg-2.0 libcurl libpng fontconfig
PKGS_DESKTOP = $(PKGS_BASE) glesv2 egl

.PHONY: desktop pi clean

desktop: bin/pos-native-desktop

bin/pos-native-desktop: $(SRC_COMMON) src/platform_desktop.c
	@mkdir -p bin
	$(CC) $(CFLAGS_COMMON) $(shell pkg-config --cflags $(PKGS_DESKTOP)) \
		$(SRC_COMMON) src/platform_desktop.c \
		-o $@ \
		$(shell pkg-config --libs $(PKGS_DESKTOP)) -lm
	@echo "== зібрано $@ =="

# Нативно на Pi: /opt/vc — стандартний шлях libraspberrypi-dev, без sysroot.
# GL/EGL лінкуються напряму на Broadcom-ові .so (не через pkg-config egl/
# glesv2 — дивись коментар при PKGS_BASE вище).
pi: bin/pos-native-pi

bin/pos-native-pi: $(SRC_COMMON) src/platform_dispmanx.c
	@mkdir -p bin
	$(CC) $(CFLAGS_COMMON) $(shell pkg-config --cflags $(PKGS_BASE)) \
		-I/opt/vc/include -I/opt/vc/include/interface/vcos/pthreads \
		-I/opt/vc/include/interface/vmcs_host/linux \
		$(SRC_COMMON) src/platform_dispmanx.c \
		-o $@ \
		$(shell pkg-config --libs $(PKGS_BASE)) \
		-L/opt/vc/lib -l:libbrcmEGL.so -l:libbrcmGLESv2.so -lbcm_host -lvcos -lvchiq_arm -lm \
		-Wl,-rpath,/opt/vc/lib
	@echo "== зібрано $@ =="

clean:
	rm -rf bin
