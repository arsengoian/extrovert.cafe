# pos-native — дві цілі:
#   make desktop  — x86_64, для локальних тестів (EGL surfaceless + Mesa
#                   llvmpipe). Потребує `source build/env-desktop.sh` перед
#                   запуском, щоб pkg-config бачив /tmp/local-sysroot.
#   make pi       — крос-компіляція під ARMv6/glibc 2.24 для реального Pi 1.
#                   Потребує build/env-pi.sh (готується окремо, коли desktop
#                   підтвердить логіку — дивись build/README.md).
#
# Джерела спільні для обох цілей; відрізняється лише platform_*.c і те,
# звідки беруться заголовки/бібліотеки.

CC ?= gcc
SRC_COMMON = src/main.c src/menu.c src/render.c src/gl.c src/telemetry.c
CFLAGS_COMMON = -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -O2 -Isrc

PKGS = cairo pangocairo librsvg-2.0 glesv2 egl libcurl libcjson libpng fontconfig

.PHONY: desktop pi clean

desktop: bin/pos-native-desktop

bin/pos-native-desktop: $(SRC_COMMON) src/platform_desktop.c
	@mkdir -p bin
	$(CC) $(CFLAGS_COMMON) $(shell pkg-config --cflags $(PKGS)) \
		$(SRC_COMMON) src/platform_desktop.c \
		-o $@ \
		$(shell pkg-config --libs $(PKGS)) -lm
	@echo "== зібрано $@ =="

# Крос-ціль: CC/SYSROOT/VC (Broadcom SDK з малини) задаються через
# build/env-pi.sh, який ще не готовий у цьому спайку (README.md пояснює
# порядок дій). Мета лишена тут, щоб було видно наступний крок.
pi: bin/pos-native-pi

bin/pos-native-pi: $(SRC_COMMON) src/platform_dispmanx.c
	@mkdir -p bin
	@test -n "$$PI_SYSROOT" || (echo "Задайте PI_SYSROOT — див. build/README.md" && exit 1)
	$(CC) $(CFLAGS_COMMON) --sysroot=$$PI_SYSROOT \
		$(shell PKG_CONFIG_SYSROOT_DIR=$$PI_SYSROOT PKG_CONFIG_PATH=$$PI_SYSROOT/usr/lib/arm-linux-gnueabihf/pkgconfig:$$PI_SYSROOT/usr/lib/pkgconfig pkg-config --cflags $(PKGS)) \
		-I$$PI_SYSROOT/opt/vc/include -I$$PI_SYSROOT/opt/vc/include/interface/vcos/pthreads \
		-I$$PI_SYSROOT/opt/vc/include/interface/vmcs_host/linux \
		$(SRC_COMMON) src/platform_dispmanx.c \
		-o $@ \
		$(shell PKG_CONFIG_SYSROOT_DIR=$$PI_SYSROOT PKG_CONFIG_PATH=$$PI_SYSROOT/usr/lib/arm-linux-gnueabihf/pkgconfig:$$PI_SYSROOT/usr/lib/pkgconfig pkg-config --libs $(PKGS)) \
		-L$$PI_SYSROOT/opt/vc/lib -lbcm_host -lvcos -lvchiq_arm -lm
	@echo "== зібрано $@ (armhf, для scp на малину) =="

clean:
	rm -rf bin
