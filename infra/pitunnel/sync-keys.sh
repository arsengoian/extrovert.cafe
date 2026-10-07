#!/bin/sh
# /usr/local/sbin/extrovert-pitunnel-sync — ключі тунелів точок із бази в
# authorized_keys користувача pitunnel (cron раз на хвилину, setup.sh).
#
# Кожен ключ — лише на свій порт: restrict знімає все, port-forwarding
# повертає тунелі, permitlisten дозволяє слухати тільки 127.0.0.1:<порт>
# точки. Тож навіть ключ, витягнутий із малини в коридорі, відкриває одне:
# цей порт на loopback дроплета.
#
# Пишемо через тимчасовий файл і mv — sshd ніколи не бачить половину файла.
# Порожня відповідь бази (база лежить) — файл не чіпаємо, інакше перезапуск
# постгреса вибивав би всі тунелі.
set -eu
DST=/home/pitunnel/.ssh/authorized_keys
TMP=$(mktemp /home/pitunnel/.ssh/.ak.XXXXXX)
trap 'rm -f "$TMP"' EXIT
docker exec extrovert-postgres-1 psql -U extrovert -d extrovert -tAq -c \
  "select 'restrict,port-forwarding,permitlisten=\"127.0.0.1:' || tunnel_port || '\" ' || tunnel_pubkey
     from points where tunnel_pubkey is not null and tunnel_port is not null order by id" > "$TMP" || exit 0
[ -s "$TMP" ] || exit 0
cmp -s "$TMP" "$DST" && exit 0
chown pitunnel:pitunnel "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$DST"
logger -t extrovert-pitunnel "authorized_keys оновлено: $(wc -l < "$DST") ключ(ів)"
