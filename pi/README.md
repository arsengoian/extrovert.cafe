# Raspberry Pi — кіоск точки

Стан пристрою на 09.08.2026: Raspberry Pi 1 Model B rev 2 (ARMv6, 512 МБ),
Raspbian 9 Stretch, Chromium 65, LXDE. `ssh pi@192.168.5.45`.

⚠️ **Файли в цій теці — реконструкція з робочої сесії, а не дамп із пристрою.**
Перед тим як накочувати, звірити з тим, що реально лежить на Pi. Найпростіше —
`scp` з машини й `diff`.

Повний опис налаштування: `../docs/raspberry-pi.md`.

## Що вже зроблено на пристрої

- [x] автозапуск Chromium у кіоск-режимі (LXDE autostart)
- [x] апаратний watchdog BCM2835, `RuntimeWatchdogUSec=14s`
- [x] сторожовий крон раз на 5 хвилин
- [x] 1080p замість 720p (`hdmi_group=1`, `hdmi_mode=16`)
- [x] повний діапазон RGB (`hdmi_pixel_encoding=2`)
- [x] прибрано запит пароля PolicyKit (з `start.sh` викинуто `service ssh start`)
- [ ] overlay FS (read-only корінь) — після тижня стабільної роботи
- [ ] 5 тестів раптового знеструмлення
- [ ] **URL оновити на `/p/kyiv-01`** — зараз у kiosk.sh старий корінь

## Бекапи на пристрої

`~/backup-2026-08-09/` — `config.txt` до кожної правки, `start.sh` до правки PolicyKit.
