# Локальні команди одним списком. Те саме є в package.json (scripts), але
# `make` не вимагає памʼятати, чи це bun-скрипт, чи docker compose, чи
# --filter по воркспейсу.
#
# Windows: цілі навмисно однорядкові й без && та пайпів — так вони
# працюють і через cmd.exe, і через sh.

# bun — із PATH, а на Windows спершу зі стандартного місця інсталятора
# (%USERPROFILE%\.bun\bin): термінал або IDE, відкриті до встановлення bun,
# тримають старий PATH без нього, і make падав з «CreateProcess ... failed».
ifeq ($(OS),Windows_NT)
BUN_EXE := $(subst \,/,$(USERPROFILE))/.bun/bin/bun.exe
BUN ?= $(if $(wildcard $(BUN_EXE)),$(BUN_EXE),bun)
else
BUN ?= bun
endif

.DEFAULT_GOAL := help
.PHONY: help up down logs ps migrate migrate-status seed seed-pull seed-apply \
        plant api ws scheduler checkbox overseer client build \
        docs docs-check kb-check kb-embed kb-store kb-push kb-ask planting-data \
        deploy-client deploy-client-dry keys-jwt keys-secret keys-ssh smoke \
        tf-plan tf-apply tf-output ssh-public \
        act-secrets act-build act-deploy admin deploy-admin deploy-admin-dry \
        release-push

## ── оточення ────────────────────────────────────────────────────────────

help:
	@echo ---------------------------------------------------------------
	@echo   make up            postgres, redis, minio - профіль local
	@echo   make down          зупинити все локальне
	@echo   make ps            що зараз крутиться
	@echo   make logs          логи контейнерів
	@echo ---------------------------------------------------------------
	@echo   make migrate       накотити міграції через dbmate
	@echo   make seed          дев-гравець, кавенятко, чек, довідник НП
	@echo   make plant         перемотати кавенятко: STAGE=1 RESET=1
	@echo   make seed-pull     вивантажити контент із БД у db/seeds
	@echo   make seed-apply    застосувати db/seeds до БД
	@echo ---------------------------------------------------------------
	@echo   make api           api на :3001 з bun --watch
	@echo   make ws            ws на :3002
	@echo   make scheduler     фонові роботи
	@echo   make checkbox      приймач ПРРО на :3003
	@echo   make overseer      алерти в Telegram
	@echo   make client        застосунок гравця на :5173
	@echo   make smoke         перевірити, що всі роути api відповідають
	@echo ---------------------------------------------------------------
	@echo   make docs          перезібрати docs/data-map.html
	@echo   make docs-check    перевірити, що карта актуальна
	@echo   make kb-check      перевірити базу знань чату
	@echo   make kb-embed      перерахувати вектори бази знань
	@echo   make kb-store      створити vector store в OpenAI - раз на оточення
	@echo   make kb-push       залити базу знань у vector store, лише змінене
	@echo   make kb-ask Q=...  що знайде пошук по базі знань
	@echo   make planting-data перерахувати геометрію спрайтів посадки
	@echo ---------------------------------------------------------------
	@echo   make deploy-client-dry   зібрати клієнт і перевірити, не викочуючи
	@echo   make deploy-client       викотити клієнт на Cloudflare Workers
	@echo   make admin               адмінка локально на :5174
	@echo   make deploy-admin-dry    зібрати адмінку й перевірити, не викочуючи
	@echo   make deploy-admin        викотити адмінку на Cloudflare Workers
	@echo   make release-push        залити реліз кіоска в публічний бакет R2
	@echo ---------------------------------------------------------------
	@echo   make keys-jwt      новий ключ підпису токенів для .env
	@echo   make keys-secret   SUPPORT_BOT_SECRET для вебхука бота підтримки
	@echo   make keys-ssh      ключ доступу до малини й дроплетів, тека keys
	@echo ---------------------------------------------------------------
	@echo   make tf-plan       що terraform збирається змінити на DigitalOcean
	@echo   make tf-apply      застосувати: дроплет, файрвол, проект
	@echo   make tf-output     адреси й готова команда ssh
	@echo   make ssh-public    зайти на публічний дроплет
	@echo ---------------------------------------------------------------
	@echo   make act-secrets   зібрати .secrets для act з локального .env
	@echo   make act-build     прогнати збірку образів локально через act
	@echo   make act-deploy    прогнати весь деплой локально через act
	@echo ---------------------------------------------------------------

# Лише інфраструктура: сервіси локально крутяться через bun (make api, ws…),
# а не в докері. `docker compose --profile local up -d` без списку підніме
# ще й їх — і другий api вчепиться в той самий 3001.
up:
	docker compose --profile local up -d postgres redis minio minio-buckets

down:
	docker compose --profile local down

ps:
	docker compose --profile local ps

logs:
	docker compose logs -f --tail=100

## ── база й дані ─────────────────────────────────────────────────────────

migrate:
	docker compose run --rm migrate up

migrate-status:
	docker compose run --rm migrate status

seed:
	$(BUN) scripts/dev-seed.mjs

# Приклад: make plant STAGE=1 RESET=1 SUPPLY=9
plant:
	$(BUN) scripts/dev-plant.mjs $(if $(STAGE),--stage $(STAGE)) $(if $(RESET),--reset) $(if $(SUPPLY),--supply $(SUPPLY))

seed-pull:
	$(BUN) scripts/seed.mjs pull

seed-apply:
	$(BUN) scripts/seed.mjs apply

## ── сервіси ─────────────────────────────────────────────────────────────

api:
	$(BUN) --watch backend/api/src/index.js

ws:
	$(BUN) backend/ws/src/index.js

scheduler:
	$(BUN) backend/scheduler/src/index.js

checkbox:
	$(BUN) backend/checkbox/src/index.js

overseer:
	$(BUN) backend/overseer/src/index.js

client:
	$(BUN) --cwd frontend/client run dev

build:
	docker compose build api ws checkbox scheduler overseer

smoke:
	$(BUN) scripts/smoke.mjs

## ── доки й база знань ───────────────────────────────────────────────────

docs:
	$(BUN) scripts/build-data-map.mjs

docs-check:
	$(BUN) scripts/build-data-map.mjs --check

kb-check:
	$(BUN) scripts/kb.mjs check

kb-embed:
	$(BUN) scripts/kb.mjs embed

kb-store:
	$(BUN) scripts/kb.mjs store

kb-push:
	$(BUN) scripts/kb.mjs push

kb-ask:
	$(BUN) scripts/kb.mjs ask "$(Q)"

planting-data:
	$(BUN) scripts/build-planting-data.mjs

## ── викочування й ключі ─────────────────────────────────────────────────

deploy-client-dry:
	$(BUN) scripts/deploy-client.mjs --dry

deploy-client:
	$(BUN) scripts/deploy-client.mjs

# Адмінка — така сама статика на Workers, як і клієнт (docs/services.md §4).
admin:
	$(BUN) run --filter @extrovert/admin dev

deploy-admin-dry:
	$(BUN) run --filter @extrovert/admin deploy:dry

deploy-admin:
	$(BUN) run --filter @extrovert/admin deploy

# Звичайний шлях релізу — CI; руками це лише для випадку «треба повз нього».
release-push:
	$(BUN) scripts/push-release.mjs

keys-jwt:
	$(BUN) scripts/keys.mjs jwt

keys-secret:
	$(BUN) scripts/keys.mjs secret

keys-ssh:
	$(BUN) scripts/keys.mjs ssh

## ── сервери (terraform) ─────────────────────────────────────────────────

tf-plan:
	$(BUN) scripts/tf.mjs plan

tf-apply:
	$(BUN) scripts/tf.mjs apply

tf-output:
	$(BUN) scripts/tf.mjs output

# Порт 2222, бо з частини мереж вихідний 22 закритий (docs/deploy.md §2.1).
ssh-public:
	$(BUN) scripts/tf.mjs ssh

## ── той самий деплой, тільки локально (act) ─────────────────────────────

act-secrets:
	$(BUN) scripts/act-secrets.mjs

# Збірка без пуша: act сам виставляє ACT=true, і workflow це враховує.
act-build:
	act -j build --secret-file .secrets

# Справжнє викочування на живий сервер з цієї машини. Образи мають бути в
# реєстрі, тобто спершу або пуш у main, або act-build із GHCR_TOKEN.
act-deploy:
	act -j deploy --secret-file .secrets
