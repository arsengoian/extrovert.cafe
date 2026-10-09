# Команди для ручних перевірок на живому проді: емулювати покупку,
# перемотати час кавенятку, зазирнути в базу.
#
# Окремий файл, а не рядки в Makefile, навмисно: тут усе, що чіпає
# прод-дані руками, і його має бути видно одним поглядом.
#
# Рецепти тут однорядкові, як і в головному Makefile, і це не стиль:
# перенос «» у кінці рядка make віддає cmd.exe як є, той про продовження не
# знає — і виконує обидві половини як дві окремі команди. d-give через це
# нарахував монети двічі (23.09.2026).
#
# make у стилі `--drink a033` не вміє: слова з дефісом він забирає собі як
# власні опції. Тому параметри — змінними:
#
# Перевіряє їх сам make ($(if ...)$(error ...)), а не `test` у рецепті: на
# Windows рецепт виконує cmd.exe, і кожен продаж починався з рядка
# 'test' is not recognized as an internal or external command.
#
#   make d-sale DRINK=a033 PAY=cash
#   make d-plant MAIL=хтось@пошта STAGE=1 RESET=1
#   make d-skip MAIL=хтось@пошта DAYS=3
#
# Гравця вибираємо поштою, а не нікнеймом: нікнейми кирилицею make на
# Windows передає знаками питання. NICK= теж працює — для латинських.
#
# Чеки створює **тільки тестовий касир** (scripts/dev-sale.mjs це перевіряє
# і без CHECKBOX_TEST_* просто не працює), але чек летить у справжній
# Checkbox, вебхук — у прод, і бонус з'являється на справжньому кіоску.
#
# Дев-скрипти на прод-базі без --prod (а продаж без --yes) не стартують
# (scripts/lib/dev-guard.mjs). Тут ці прапорці стоять у самих рецептах:
# ціль d-* і є явне «так, на проді» — make власні опції з дефісом однаково
# не пропустив би (03.10.2026). Червоне попередження скрипт друкує все одно.

.PHONY: d-help d-sale d-sales d-list d-plant d-skip d-supply d-give d-user d-db d-sql d-tunnel d-pi d-router

# Через bash явно: make на Windows виконує рецепти не тим шелом, і скрипт
# із шебангом просто не запускається.
PRODDB := bash scripts/prod-db.sh
POINT  ?= kyiv-01
CMD    ?=
LPORT  ?= 47199
TARGET ?= 192.168.199.1:80
DRINK  ?=
PAY    ?= card
NICK   ?=
MAIL   ?=
STAGE  ?=
RESET  ?=
PLANT  ?=
SUPPLY ?= 9
COINS  ?=
SILVER ?=
BEANS  ?=
EVERY  ?= 20
COUNT  ?= 20

d-help:
	@echo   make d-list                    які напої є в сідах
	@echo   make d-sale DRINK=a033 PAY=cash   покупка тестовим касиром - чек у прод
	@echo   make d-sales EVERY=20 COUNT=20    випадковий напій раз на EVERY с, до COUNT штук або Ctrl+C
	@echo   make d-plant MAIL=пошта STAGE=1 RESET=1 PLANT=2   стадія кавенятка (PLANT - номер, типово перше), з очищенням посадженого
	@echo   make d-skip MAIL=пошта DAYS=3  «минуло N днів» (типово 1) для всіх кавенят: гейт, полив, настрій
	@echo   make d-supply MAIL=пошта SUPPLY=9   насипати препаратів
	@echo   make d-give MAIL=пошта COINS=500   монети/зерна: COINS, SILVER, BEANS
	@echo   make d-user MAIL=пошта         баланси, кавенята, останні чеки
	@echo   make d-db                      psql до прод-бази
	@echo   make d-tunnel                  тунель до прод-бази на localhost:5455, доки не Ctrl+C
	@echo   make d-pi                      ssh на малину точки через тунель (POINT=kyiv-01 CMD='uptime')
	@echo   make d-router                  веб-адмінка роутера точки на http://localhost:47199 (TARGET, LPORT), Ctrl+C — закрити

d-list:
	$(BUN) scripts/dev-sale.mjs --list

# Ціну й бонус бере з сідів; --pay cash|card. Далі все як у житті:
# Checkbox → вебхук → бонус → QR на екрані точки.
d-sale:
	@$(if $(strip $(DRINK)),,$(error вкажи напій: make d-sale DRINK=a033 (список - make d-list)))
	$(BUN) scripts/dev-sale.mjs --drink $(DRINK) --pay $(PAY) --yes

# Потік продажів: раз на EVERY секунд випадковий активний напій, до COUNT
# штук (типово 20 раз на 20 с) або до Ctrl+C. Кожен — той самий d-sale.
d-sales:
	$(BUN) scripts/dev-sales.mjs --every $(EVERY) --count $(COUNT) --pay $(PAY) --yes

d-plant:
	@$(if $(strip $(MAIL)$(NICK)),,$(error вкажи гравця: make d-plant MAIL=пошта STAGE=1))
	$(PRODDB) $(BUN) scripts/dev-plant.mjs --prod $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) $(if $(STAGE),--stage $(STAGE),) $(if $(RESET),--reset,) $(if $(PLANT),--plant $(PLANT),)

d-skip:
	@$(if $(strip $(MAIL)$(NICK)),,$(error вкажи гравця: make d-skip MAIL=пошта))
	$(PRODDB) $(BUN) scripts/dev-plant.mjs --prod $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) --skip $(if $(DAYS),$(DAYS),1) $(if $(PLANT),--plant $(PLANT),)

d-supply:
	@$(if $(strip $(MAIL)$(NICK)),,$(error вкажи гравця: make d-supply MAIL=пошта))
	$(PRODDB) $(BUN) scripts/dev-plant.mjs --prod $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) --supply $(SUPPLY)

# Монети й зерна — щоб не чекати добу заради перевірки екрана, якому
# потрібен баланс. Рядок у журналі пишеться теж (reason='admin'), інакше
# статистика адмінки розійшлася б із балансами.
d-give:
	@$(if $(strip $(MAIL)$(NICK)),,$(error вкажи гравця: make d-give MAIL=пошта COINS=500))
	@$(if $(strip $(COINS)$(SILVER)$(BEANS)),,$(error нема що нараховувати: COINS=, SILVER= або BEANS=))
	$(PRODDB) $(BUN) scripts/dev-give.mjs --prod $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) $(if $(COINS),--coins $(COINS),) $(if $(SILVER),--silver $(SILVER),) $(if $(BEANS),--beans $(BEANS),)

d-user:
	@$(if $(strip $(MAIL)$(NICK)),,$(error вкажи гравця: make d-user MAIL=пошта))
	$(PRODDB) $(BUN) scripts/dev-user.mjs $(if $(MAIL),--email $(MAIL),--nickname $(NICK))

# DATABASE_URL з'являється всередині prod-db.sh, тому розкриває його той
# шел, що вже має змінну: інакше psql отримав би порожній рядок і завис
# на порожньому вводі.
d-db:
	$(PRODDB) sh -c 'psql "$$DATABASE_URL"'

# Тунель до прод-бази для власного клієнта (DBeaver, TablePlus): localhost:5455,
# база extrovert, користувач extrovert, пароль — POSTGRES_PASSWORD у .env.prod
# (у термінал його не друкуємо). Тримається, доки не Ctrl+C, і зникає разом
# із командою — той самий prod-db.sh, що й решта d-*.
d-tunnel:
	$(PRODDB) sh -c 'echo "тунель відкритий: localhost:5455, база extrovert, користувач extrovert (пароль — POSTGRES_PASSWORD у .env.prod). Ctrl+C — закрити"; while :; do sleep 3600; done'

# ssh на малину точки через її зворотний тунель (scripts/pi-ssh.sh). Запускати
# з Windows теж можна — make кличе bash, а скрипт сам лагодить права на ключі.
d-pi:
	bash scripts/pi-ssh.sh $(POINT) $(CMD)

# Прокинути локальний порт у мережу точки через малину: типово веб-адмінка
# роутера на http://localhost:8080 (scripts/pi-forward.sh). Ctrl+C — закрити.
d-router:
	bash scripts/pi-forward.sh $(POINT) $(LPORT) $(TARGET)

# Довільний запит: make d-sql Q="select count(*) from users"
d-sql:
	@$(if $(strip $(Q)),,$(error вкажи запит: make d-sql Q=...))
	$(PRODDB) sh -c 'psql "$$DATABASE_URL" -Atc "$(Q)"'
