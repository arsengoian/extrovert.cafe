# Raspberry Pi → кіоск із нашим меню

Під **Pi 1 Model B rev 2 / Raspbian 9 (Stretch)**. Для Pi 4/5 і Bookworm
відмінності позначені окремо.

---

## 0. Спершу зменшити роздільну здатність

На Pi 1 браузер у 1080p ляже. 720p виглядає майже так само на 18–21", а
навантаження падає вдвічі.

`sudo nano /boot/config.txt`

```
hdmi_group=1
hdmi_mode=4          # 1280×720 @60Hz
disable_overscan=1
gpu_mem=128          # більше памʼяті відео — браузеру легше
```

---

## 1. Автологін у графічну сесію

```bash
sudo raspi-config
#  Boot Options → Desktop / CLI → Desktop Autologin
```

---

## 2. Пакети

```bash
sudo apt update
sudo apt install -y chromium-browser unclutter xdotool
```

> Stretch — EOL, репозиторії в архіві. Якщо `apt update` лається, підмінити
> джерела: `sudo sed -i 's|deb.debian.org|archive.debian.org|g' /etc/apt/sources.list`
> і додати `Acquire::Check-Valid-Until "false";` у `/etc/apt/apt.conf.d/99no-check-valid`.

---

## 3. Скрипт кіоску з автоперезапуском

`nano /home/pi/kiosk.sh`

```bash
#!/bin/bash
URL="http://localhost:8080/menu.html"     # або http://192.168.x.x:3000

# ніякого гасіння екрана
xset s off; xset -dpms; xset s noblank
unclutter -idle 0.1 -root &

# прибрати «Chromium некоректно завершив роботу»
P="$HOME/.config/chromium"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$P/Local State" 2>/dev/null
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
    "$P/Default/Preferences" 2>/dev/null

# впав — піднявся
while true; do
  chromium-browser \
    --kiosk --incognito --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble --disable-translate \
    --no-first-run --fast --fast-start \
    --disable-pinch --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required \
    "$URL"
  sleep 3
done
```

```bash
chmod +x /home/pi/kiosk.sh
```

---

## 4. Автозапуск

`nano /home/pi/.config/lxsession/LXDE-pi/autostart`

```
@/home/pi/kiosk.sh
```

> **Bookworm (Pi 4/5)** використовує Wayland/labwc, LXDE-autostart там не працює.
> Там роблять через `~/.config/wayfire.ini` або systemd-юніт.

Перезавантажити: `sudo reboot`

---

## 5. Пережити блекаут

### 5.1 Апаратний watchdog — підніме, якщо система зависла

```bash
echo "dtparam=watchdog=on" | sudo tee -a /boot/config.txt
sudo nano /etc/systemd/system.conf
```
```
RuntimeWatchdogSec=15
RebootWatchdogSec=2min
```

### 5.2 Read-only файлова система — щоб раптове зникнення живлення не било картку

```bash
sudo raspi-config
#  Performance / Advanced Options → Overlay File System → Enable
```

Після ввімкнення система стає незмінною: будь-який збій живлення лікується
перезавантаженням. **Щоб щось змінити — тимчасово вимкнути overlay, правити,
увімкнути назад.**

---

## 6. Перевірка перед встановленням

- [ ] Висмикнути живлення на ходу 5 разів — щоразу має піднятися в меню саме
- [ ] Лишити на добу — перевірити, чи не гасне екран і чи не тече памʼять
- [ ] Заміряти FPS: `chromium://gpu` і просто на око при прокрутці
- [ ] Перевірити, що курсор не видно і немає жодної системної плашки
- [ ] Вимкнути Bluetooth і зайві сервіси: `sudo systemctl disable bluetooth hciuart triggerhappy`

---

## 7. Запасний варіант для Pi 1 — статична картинка

Якщо Chromium виявиться надто повільним, те саме, що зараз у Zernova, але
без флешки. Працює на фреймбуфері, без X взагалі, споживає ~3 Вт.

```bash
sudo apt install -y fbi
# у /etc/rc.local перед exit 0:
fbi -T 1 -d /dev/fb0 -noverbose -a /home/pi/menu.png &
```

Оновлення меню — `scp` нового PNG і `killall fbi`. Ціни лишаються картинкою,
але хоч без поїздок на точку.
