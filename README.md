# extrovert.cafe — монорепо

Самокав'ярні: кіоск на точці, гейміфікація в телефоні, бекенд і звітність.

```
docs/        документація; реєстр — docs/README.md, уся разом — docs/data-map.html
pos-native/  прод-кіоск: нативний рендерер меню (C, Cairo, GLES2) для Raspberry Pi 1
pi/          усе про малину: керований стек з автооновленням, заміри, скрипти
pos/         Cloudflare Worker точки: меню й релізи з R2, запасна браузерна сторінка кіоска
client/      застосунок гравця для телефона — поки лише заготовка
api/         REST-бекенд для client, кіоска й адмінки
ws/          сервер подій (WebSocket) — «ти купив каву, забери бонус»
checkbox/    ПРРО Checkbox: вебхук продажів, звірка цін каталогу
overseer/    telegram-бот звітності, працює на лупі, пише в груповий чат
scripts/     збірка сторінки документації
docker/      образи й конфіги контейнерів
```

Більшість бекенд-сервісів поки заготовки; що з цього реально працює —
`docs/services.md` §5.

## Стек

Кіоск — C, Cairo, GLES2 на Raspberry Pi 1. Бекенд — Node.js, Postgres, Redis
у docker compose. Застосунок гравця й адмінка — React, статика на Cloudflare
Workers. R2 — меню, релізи й відео. GlitchTip — помилки з усіх сервісів.
Повна карта — `docs/services.md`.

## Запуск бекенда

```bash
cp .env.example .env      # заповнити
docker compose up -d
docker compose ps
```

## Кіоск і Worker

```bash
pos-native/docker/build.sh       # один раз: образ із тулчейном
pos-native/docker/make.sh        # нативний кіоск для ПК; на малині — make pi
npm run dev -w pos               # Worker локально: меню, релізи, запасна сторінка
```

Як реліз кіоска потрапляє на точку — `docs/raspberry-pi.md`.

## Документація

```bash
npm run docs:map          # зібрати docs/data-map.html з усіх доків реєстру
npm run docs:map:check    # код 1, якщо сторінка застаріла або в реєстрі дірка
```

## Головна домовленість про URL

**Ідентифікатор точки живе в URL з першого дня.** Див. `docs/urls.md`.
Не додавай роутів без `points/<point>` — переробляти потім дорожче.
