#!/bin/sh
# setup.sh — приймач зворотних тунелів малин на дроплеті (raspberry-pi.md,
# «Тунель»). Запускати від root на дроплеті; повторний запуск нічого не ламає:
#
#   scp -P 2222 -i keys/extrovert_ed25519 -r infra/pitunnel root@46.101.213.31:/tmp/
#   ssh -p 2222 -i keys/extrovert_ed25519 root@46.101.213.31 sh /tmp/pitunnel/setup.sh
#
# Що робить:
#   * користувач pitunnel без пароля й оболонки;
#   * Match-блок sshd: лише зворотні порти на 127.0.0.1, без сесій і без
#     прямих тунелів; мертві сесії гасяться за ~90 с, щоб порт звільнявся;
#   * sync-keys.sh у cron раз на хвилину: ключі точок із бази (points) →
#     authorized_keys, кожен з permitlisten лише на свій порт.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)

id pitunnel >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/pitunnel --shell /usr/sbin/nologin pitunnel
install -d -m 700 -o pitunnel -g pitunnel /home/pitunnel/.ssh
[ -f /home/pitunnel/.ssh/authorized_keys ] || install -m 600 -o pitunnel -g pitunnel /dev/null /home/pitunnel/.ssh/authorized_keys

install -m 644 "$HERE/sshd-pitunnel.conf" /etc/ssh/sshd_config.d/20-pitunnel.conf
install -m 755 "$HERE/sync-keys.sh" /usr/local/sbin/extrovert-pitunnel-sync
printf '* * * * * root /usr/local/sbin/extrovert-pitunnel-sync >/dev/null 2>&1\n' > /etc/cron.d/extrovert-pitunnel
chmod 644 /etc/cron.d/extrovert-pitunnel

# Перевірка до перезавантаження: битий конфіг sshd — це зачинені двері для всіх.
sshd -t
systemctl reload ssh
/usr/local/sbin/extrovert-pitunnel-sync
echo "✓ pitunnel готовий; ключів у authorized_keys: $(grep -c . /home/pitunnel/.ssh/authorized_keys || true)"
