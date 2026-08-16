# extrovert.cafe — монорепо

Самокав'ярні: кіоск на точці, гейміфікація в телефоні, бекенд і звітність.

```
docs/       документація: залізо, стек, ПРРО, гейміфікація
pi/         те, що живе на Raspberry Pi (кіоск-скрипти, автозапуск, watchdog)
pos/        фронтенд кіоска — Cloudflare Workers, статика + меню з R2
client/     фронтенд для телефона — гейміфікація, бонуси, кавенятка
api/        REST-бекенд для client і pos
ws/         сервер подій (WebSocket) — «твоя кава готова», нарахування бонусів
checkbox/   мікросервіс: приймає вебхуки ПРРО Checkbox, віддає події далі
overseer/   telegram-бот звітності, працює на лупі, пише в груповий чат
docker/     конфіги контейнерів
```

## Стек

Node.js · Vue · Redis · Postgres · R2 для статики · GlitchTip для помилок.
Фронтенди статичні, деплой на Cloudflare Workers. Бекенд — docker compose.
Адмінка Laravel Filament — у планах; поки нас двоє, у базу ходимо напряму.

## Запуск бекенда

```bash
cp .env.example .env      # заповнити
docker compose up -d
docker compose ps
```

## Фронтенди

```bash
cd pos    && npm i && npm run dev      # кіоск
cd client && npm i && npm run dev      # телефон
```

## Головна домовленість про URL

**Ідентифікатор точки живе в URL з першого дня.** Див. `docs/urls.md`.
Не додавай роутів без `points/<point>` — переробляти потім дорожче.
