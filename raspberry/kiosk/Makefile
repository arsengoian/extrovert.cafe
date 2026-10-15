# kiosk — дві цілі:
#   make desktop  — bin/kiosk-desktop, x86_64, для локальних тестів (EGL
#                   surfaceless + Mesa llvmpipe). Збирається в контейнері
#                   docker/desktop.Dockerfile (docker/make.sh).
#   make pi       — bin/kiosk, ARMv6 під Pi 1. Не крос-компіляція і не на
#                   самій малині: docker/make-pi.sh запускає цей make у
#                   контейнері з тим самим Raspbian Stretch під armv6
#                   (pi.Dockerfile), тобто з тими самими gcc 6.3 і
#                   glibc 2.24, що на пристрої. На точці компіляція з'їдала
#                   ~80 с CPU — рівно стільки меню смикалось на очах у
#                   клієнта (docs/raspberry-pi.md §3). libcjson-dev у Stretch
#                   немає — cJSON тому вендориться в third_party/.
#
# Джерела спільні для обох цілей; відрізняється лише platform_*.c і те,
# звідки беруться заголовки/бібліотеки.

CC ?= gcc
SRC_COMMON = src/main.c src/menu.c src/render.c src/gl.c src/telemetry.c \
             src/svgtpl.c src/qr.c src/bonus.c src/popup.c src/update.c src/selftest.c \
             src/ws.c \
             third_party/cjson/cJSON.c third_party/qrcodegen/qrcodegen.c
CFLAGS_COMMON = -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -O2 -Isrc \
                -Ithird_party/cjson -Ithird_party/qrcodegen -pthread

# glesv2/egl тут ідуть окремо від решти пакетів: на десктопі це системний
# Mesa (потрібен для surfaceless-тесту), а на Pi — навпаки, GL/EGL мають бути
# Broadcom-ові (libbrcmEGL/libbrcmGLESv2 з /opt/vc/lib), не Mesa. Стретч на
# цій малині ставить генеричні libEGL.so/libGLESv2.so від Mesa в
# /usr/lib/arm-linux-gnueabihf (через *-mesa-dev, потрібні лише як залежність
# для заголовків) — pkg-config егл/glesv2 резолвиться саме туди. Якщо зібрати
# bin/kiosk проти них, eglInitialize намагається піднятись як X11-клієнт
# (DRI2/DRI3) замість dispmanx і падає — на цьому залізі нема навіть vc4/KMS
# (lsmod чистий), тож єдиний робочий шлях — лінкуватись напряму на
# /opt/vc/lib/libbrcmEGL.so /opt/vc/lib/libbrcmGLESv2.so, в обхід pkg-config.
PKGS_BASE = cairo pangocairo librsvg-2.0 libcurl libpng fontconfig
PKGS_DESKTOP = $(PKGS_BASE) glesv2 egl

# Куди кіоск іде за подіями (ws.c). Адреса прошита в збірку, а не взята з
# оточення, навмисно: десктопна ціль — це тести на машині розробника, де
# прод чіпати не треба, а на малині навпаки — жодного локального ws немає
# і бути не може. Змінна WS_URL однаково перебиває, коли треба інше.
WS_URL_DESKTOP = ws://127.0.0.1:3002/
WS_URL_PI = wss://ws.extrovert.cafe/
# Те саме для api: звідти кіоск бере знімок стану точки після підключення.
API_URL_DESKTOP = http://127.0.0.1:3001/api/v1
API_URL_PI = https://api.extrovert.cafe/api/v1

.PHONY: desktop pi tools clean

desktop: bin/kiosk-desktop bin/uploader-desktop bin/telemetry-desktop

bin/kiosk-desktop: $(SRC_COMMON) src/platform_desktop.c
	@mkdir -p bin
	$(CC) $(CFLAGS_COMMON) -DWS_DEFAULT_URL='"$(WS_URL_DESKTOP)"' -DAPI_DEFAULT_URL='"$(API_URL_DESKTOP)"' $(shell pkg-config --cflags $(PKGS_DESKTOP)) \
		$(SRC_COMMON) src/platform_desktop.c \
		-o $@ \
		$(shell pkg-config --libs $(PKGS_DESKTOP)) -lm
	@echo "== зібрано $@ =="

# Ціль для малини (у Pi-контейнері, docker/make-pi.sh): /opt/vc — стандартний
# шлях libraspberrypi-dev усередині того самого Raspbian, без sysroot.
# GL/EGL лінкуються напряму на Broadcom-ові .so (не через pkg-config egl/
# glesv2 — дивись коментар при PKGS_BASE вище).
pi: bin/kiosk bin/uploader bin/telemetry

bin/kiosk: $(SRC_COMMON) src/platform_dispmanx.c
	@mkdir -p bin
	$(CC) $(CFLAGS_COMMON) -DWS_DEFAULT_URL='"$(WS_URL_PI)"' -DAPI_DEFAULT_URL='"$(API_URL_PI)"' $(shell pkg-config --cflags $(PKGS_BASE)) \
		-I/opt/vc/include -I/opt/vc/include/interface/vcos/pthreads \
		-I/opt/vc/include/interface/vmcs_host/linux \
		$(SRC_COMMON) src/platform_dispmanx.c \
		-o $@ \
		$(shell pkg-config --libs $(PKGS_BASE)) \
		-L/opt/vc/lib -l:libbrcmEGL.so -l:libbrcmGLESv2.so -lbcm_host -lvcos -lvchiq_arm -lm \
		-Wl,-rpath,/opt/vc/lib
	@echo "== зібрано $@ =="

# Заливка відео в R2 (src/uploader/uploader.c — компонент uploader стеку,
# 15.10.2026). Окремий процес, а не потік кіоска: заливка живе й падає
# незалежно від меню, а кіоск не перезапускається, коли міняється лише вона.
# Потрібні тільки libcurl і cJSON — жодного GL, тож правило одне на обидві
# цілі: bin/uploader — у Pi-контейнері, bin/uploader-desktop — у десктопному.
SRC_UPLOADER = src/uploader/uploader.c third_party/cjson/cJSON.c

bin/uploader bin/uploader-desktop: $(SRC_UPLOADER)
	@mkdir -p bin
	$(CC) -std=c11 -Wall -Wextra -O2 -Ithird_party/cjson $(shell pkg-config --cflags libcurl) \
		$(SRC_UPLOADER) -o $@ $(shell pkg-config --libs libcurl)
	@echo "== зібрано $@ =="

# Проби точки в api (src/pitelemetry/pitelemetry.c — компонент telemetry
# стеку, 15.10.2026; telemetry.sh exec-ає його). Ім'я бінарника — як у
# компонента: супервізор порівнює bin/<компонент> між релізами (same_code).
bin/telemetry bin/telemetry-desktop: src/pitelemetry/pitelemetry.c
	@mkdir -p bin
	$(CC) -std=c11 -Wall -Wextra -O2 $(shell pkg-config --cflags libcurl) \
		$< -o $@ $(shell pkg-config --libs libcurl)
	@echo "== зібрано $@ =="

# Службові утиліти для малини — не частина релізу (make-release.sh бере лише
# bin/kiosk, bin/uploader і bin/telemetry). dispmanx-snap: знімок усього екрана з ПК (tools/dispmanx-snap.c).
tools: bin/dispmanx-snap

bin/dispmanx-snap: tools/dispmanx-snap.c
	@mkdir -p bin
	$(CC) -O2 -Wall -I/opt/vc/include -I/opt/vc/include/interface/vcos/pthreads \
		-I/opt/vc/include/interface/vmcs_host/linux $< -o $@ \
		-L/opt/vc/lib -lbcm_host -lvcos -lvchiq_arm -Wl,-rpath,/opt/vc/lib
	@echo "== зібрано $@ =="

clean:
	rm -rf bin
