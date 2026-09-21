# extrovert.cafe — монорепо

Самокав'ярні: кіоск на точці, гейміфікація в телефоні, бекенд і звітність.

```
docs/        документація; реєстр — docs/README.md, уся разом — docs/data-map.html
pos-native/  прод-кіоск: нативний рендерер меню (C, Cairo, GLES2) для Raspberry Pi 1
pi/          усе про малину: керований стек з автооновленням, заміри, скрипти
pos/         Cloudflare Worker точки: меню й релізи з R2, запасна браузерна сторінка кіоска
client/      застосунок гравця для телефона: кавенятко, монети, маркет, чат
api/         REST-бекенд для client, кіоска й адмінки
ws/          сервер подій (WebSocket) — «ти купив каву, забери бонус»
checkbox/    ПРРО Checkbox: вебхук продажів, опитування чеків, звірка цін
scheduler/   фонові роботи за розкладом: outbox, покази маркету, Нова Пошта
overseer/    telegram-бот звітності: мовчання точок, помилки, щоденний звіт
lib/         спільне для сервісів: Postgres, Redis, outbox, R2, логер
db/          міграції (dbmate) і сіди контенту
scripts/     локальні інструменти: сіди, ключі, база знань, деплой, доки
keys/        приватні ключі доступу; у git не їде (див. keys/README.md)
docker/      образи й конфіги контейнерів
```

Що з цього реально працює — `docs/services.md` §5.

## Стек

Кіоск — C, Cairo, GLES2 на Raspberry Pi 1. Бекенд — Node.js, Postgres, Redis
у docker compose. Застосунок гравця й адмінка — React, статика на Cloudflare
Workers. R2 — меню, релізи й відео. GlitchTip — помилки з усіх сервісів.
Повна карта — `docs/services.md`.

## Запуск локально

```bash
cp .env.example .env      # заповнити; ключ підпису — make keys-jwt
make up                   # postgres, redis, minio (локальний S3 замість R2)
make migrate              # схема
make seed                 # дев-гравець, кавенятко, чек, довідник НП
```

Далі кожен сервіс — у своєму терміналі: `make api`, `make ws`,
`make scheduler`, `make client`. Перевірити, що все живе: `make smoke`.

**Усі локальні команди — `make help`.** Те саме продубльовано в
`package.json` (`bun run …`): make зручніший, але не обовʼязковий.

Оточення визначає `APP_ENV`: локально сервіси ходять у MinIO й бакети з
суфіксом `-dev`, у прод-бакети записати з машини розробника не вийде
(`docs/services.md` §2.1).

## Кіоск і Worker

```bash
pos-native/docker/build.sh       # один раз: образ із тулчейном
pos-native/docker/make.sh        # нативний кіоск для ПК; на малині — make pi
bun run --filter @extrovert/pos prices:push   # меню точки в публічний бакет R2
```

Як реліз кіоска потрапляє на точку — `docs/raspberry-pi.md`.

## Документація

```bash
bun run docs:map          # зібрати docs/data-map.html з усіх доків реєстру
bun run docs:map:check    # код 1, якщо сторінка застаріла або в реєстрі дірка
```

## Головна домовленість про URL

**Ідентифікатор точки живе в URL з першого дня.** Див. `docs/urls.md`.
Не додавай роутів без `points/<point>` — переробляти потім дорожче.
