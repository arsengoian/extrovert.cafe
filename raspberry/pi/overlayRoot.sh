#!/bin/sh
# overlayRoot.sh — корінь лише для читання, усі зміни в памʼять.
#
# Ставиться як `init=/sbin/overlayRoot.sh` у /boot/cmdline.txt. Ядро запускає
# цей скрипт замість systemd; він підкладає під корінь overlayfs і аж потім
# віддає керування справжньому init.
#
# НАВІЩО. Картка на точці вмирає від двох речей: зносу й запису в мить
# просідання живлення (docs/raspberry-pi.md §6-тер). Read-only корінь знімає
# обидві: у нього не пишуть узагалі. Усе, що має пережити перезавантаження,
# лежить на окремому розділі `data`, змонтованому в /home/pi/extrovert, —
# стек, релізи, стан, наші логи. Решта (журнали системи, тимчасові файли)
# живе в tmpfs і зникає при перезавантаженні. Це не втрата: своє ми пишемо в
# /home/pi/extrovert/logs, а системний syslog на кіоску ніхто не читав.
#
# ЯК ВИМКНУТИ, якщо щось піде не так: прибрати `init=/sbin/overlayRoot.sh` з
# /boot/cmdline.txt — і система завантажиться як раніше, з писаним коренем.
# Розділ boot має FAT, тож правити його можна з будь-якого ПК, навіть із
# Windows, без Linux під рукою. Другий шлях — параметр `nooverlay` у тому ж
# рядку: скрипт побачить його й одразу віддасть керування системі.
#
# ГОЛОВНЕ ПРАВИЛО ЦЬОГО ФАЙЛА: він не має права залишити точку без системи.
# Тому кожен крок перевіряється, і будь-яка невдача означає не «зупинитись»,
# а «завантажитись без overlay». Краще картка, що зношується, ніж чорний
# екран у публічному коридорі.
set -u

# Ядро запускає init без PATH (передає лише HOME і TERM). dash підставляє свій
# типовий, але покладатися на це не варто: chroot у Raspbian лежить у
# /usr/sbin, і варто йому не знайтися — ми вже з read-only коренем і без init.
PATH=/sbin:/usr/sbin:/bin:/usr/bin
export PATH

REAL_INIT=/sbin/init
LOG=/dev/kmsg          # у dmesg видно навіть тоді, коли решти ще немає

# Аргументи, що їх ядро передало init, треба віддати справжньому init як є.
# Зберігаємо тут, на верхньому рівні: усередині функції "$@" — це вже
# аргументи функції, і fallback віддавав systemd власний текст помилки.
# systemd на зайвий аргумент відповідає «Excess arguments» і виходить, а це
# для PID 1 паніка ядра — тобто рівно той чорний екран, від якого ця гілка
# мала рятувати (знайдено на перевірці образу 25.09.2026, до першого запуску).
INIT_ARGS="$*"

say() { echo "overlayRoot: $*" > "$LOG" 2>/dev/null || true; }

# Аварійний вихід: віддаємо керування системі на звичайному корені.
# $INIT_ARGS навмисно без лапок — це список слів, а не одне слово.
fallback() {
    say "НЕ вдалося ($*) — вантажуся без overlay"
    exec "$REAL_INIT" $INIT_ARGS
}

mount -t proc proc /proc 2>/dev/null
mount -t sysfs sys /sys 2>/dev/null

# Свідома відмова від overlay одним словом у cmdline.
if grep -qw nooverlay /proc/cmdline 2>/dev/null; then
    say "у cmdline є nooverlay — вантажуся як звичайно"
    exec "$REAL_INIT" $INIT_ARGS
fi

modprobe overlay 2>/dev/null
grep -qw overlay /proc/filesystems || fallback "ядро не вміє overlayfs"

# Усе, чим користуємось далі, має бути на місці ДО першої незворотної дії.
# Перевірити дешево; виявити брак pivot_root уже з read-only коренем — ні.
for tool in pivot_root chroot mount mkdir sed; do
    command -v "$tool" >/dev/null 2>&1 || fallback "немає $tool"
done

# Каталог під шари мусить лежати на картці готовим. Ядро монтує корінь
# read-only (root_mountflags = MS_RDONLY; rw в cmdline немає, rw робить уже
# systemd за fstab) — тобто на цьому кроці створити каталог неможливо в
# принципі. mkdir -p на наявному каталозі нічого не пише й не падає навіть на
# ro. Перша версія створювала його тут і тихо йшла у fallback щоразу.
mkdir -p /mnt/overlay || fallback "немає де створити /mnt/overlay"

# Корінь зараз змонтований ядром (rootwait, rootfstype=ext4). Лишаємо його
# read-only й беремо як нижній шар.
mount -o remount,ro / || fallback "не перемонтувати корінь у ro"

# tmpfs під зміни. Розмір — половина памʼяті: на Pi 1 це ~185 МБ, а пишуть
# туди лише журнали системи й дрібниці; усе важке живе на розділі data.
mount -t tmpfs -o size=50%,mode=0755 tmpfs /mnt/overlay || fallback "немає tmpfs"

mkdir -p /mnt/overlay/upper /mnt/overlay/work /mnt/overlay/newroot \
    || fallback "не створити шари"

mount -t overlay overlay \
    -o lowerdir=/,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work \
    /mnt/overlay/newroot || fallback "не змонтувати overlay"

# Переносимо старий корінь усередину нового, щоб pivot_root мав куди його
# подіти, і щоб його потім було видно в /mnt/lower — це рятує, коли треба
# зазирнути, що ж там насправді на картці.
# Корінь у fstab описаний як ext4 на mmcblk0p7 — під overlay це вже неправда,
# і systemd-remount-fs спробував би перемонтувати overlay з опціями ext4.
# Правимо копію у ВЕРХНЬОМУ шарі: на картку це не пише, а systemd бачить
# рівно те, що треба. Рядок не видаляємо, а коментуємо — щоб той, хто
# завантажиться без overlay, побачив його на місці.
if [ -f /mnt/overlay/newroot/etc/fstab ]; then
    sed -i "s|^\(/dev/mmcblk0p7[[:space:]].*\)$|# під overlay корінь не перемонтовується: \1|"         /mnt/overlay/newroot/etc/fstab 2>/dev/null || say "fstab лишився як був"
fi

mkdir -p /mnt/overlay/newroot/mnt/lower || fallback "не створити /mnt/lower"
mount --bind / /mnt/overlay/newroot/mnt/lower || fallback "не прибрати нижній шар"

cd /mnt/overlay/newroot || fallback "не перейти в новий корінь"
pivot_root . mnt/lower || fallback "pivot_root"

# /proc і /sys переїжджають за нами; решту підніме systemd.
mount --move /mnt/lower/proc /proc 2>/dev/null
mount --move /mnt/lower/sys /sys 2>/dev/null

say "корінь read-only, зміни в tmpfs — віддаю керування системі"
exec chroot . "$REAL_INIT" "$@"
