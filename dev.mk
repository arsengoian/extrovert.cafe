# Команди для ручних перевірок на живому проді: емулювати покупку,
# перемотати час кавенятку, зазирнути в базу.
#
# Окремий файл, а не рядки в Makefile, навмисно: тут усе, що чіпає
# прод-дані руками, і його має бути видно одним поглядом.
#
# make у стилі `--drink a033` не вміє: слова з дефісом він забирає собі як
# власні опції. Тому параметри — змінними:
#
#   make d-sale DRINK=a033 PAY=cash
#   make d-plant MAIL=хтось@пошта STAGE=1 RESET=1
#   make d-skip MAIL=хтось@пошта
#
# Гравця вибираємо поштою, а не нікнеймом: нікнейми кирилицею make на
# Windows передає знаками питання. NICK= теж працює — для латинських.
#
# Чеки створює **тільки тестовий касир** (scripts/dev-sale.mjs це перевіряє
# і без CHECKBOX_TEST_* просто не працює), але чек летить у справжній
# Checkbox, вебхук — у прод, і бонус з'являється на справжньому кіоску.

.PHONY: d-help d-sale d-list d-plant d-skip d-supply d-user d-db

# Через bash явно: make на Windows виконує рецепти не тим шелом, і скрипт
# із шебангом просто не запускається.
PRODDB := bash scripts/prod-db.sh
DRINK  ?=
PAY    ?= card
NICK   ?=
MAIL   ?=
STAGE  ?=
RESET  ?=
SUPPLY ?= 9

d-help:
	@echo   make d-list                    які напої є в сідах
	@echo   make d-sale DRINK=a033 PAY=cash   покупка тестовим касиром - чек у прод
	@echo   make d-plant MAIL=пошта STAGE=1 RESET=1   стадія кавенятка, з очищенням посадженого
	@echo   make d-skip MAIL=пошта         перемотати час: добовий гейт минув
	@echo   make d-supply MAIL=пошта SUPPLY=9   насипати препаратів
	@echo   make d-user MAIL=пошта         баланси, кавенята, останні чеки
	@echo   make d-db                      psql до прод-бази

d-list:
	$(BUN) scripts/dev-sale.mjs --list

# Ціну й бонус бере з сідів; --pay cash|card. Далі все як у житті:
# Checkbox → вебхук → бонус → QR на екрані точки.
d-sale:
	@test -n "$(DRINK)" || (echo "вкажи напій: make d-sale DRINK=a033 (список - make d-list)"; exit 1)
	$(BUN) scripts/dev-sale.mjs --drink $(DRINK) --pay $(PAY)

d-plant:
	@test -n "$(MAIL)$(NICK)" || (echo "вкажи гравця: make d-plant MAIL=пошта STAGE=1"; exit 1)
	$(PRODDB) $(BUN) scripts/dev-plant.mjs $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) \
		$(if $(STAGE),--stage $(STAGE),) $(if $(RESET),--reset,)

d-skip:
	@test -n "$(MAIL)$(NICK)" || (echo "вкажи гравця: make d-skip MAIL=пошта"; exit 1)
	$(PRODDB) $(BUN) scripts/dev-plant.mjs $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) --skip

d-supply:
	@test -n "$(MAIL)$(NICK)" || (echo "вкажи гравця: make d-supply MAIL=пошта"; exit 1)
	$(PRODDB) $(BUN) scripts/dev-plant.mjs $(if $(MAIL),--email $(MAIL),--nickname $(NICK)) --supply $(SUPPLY)

d-user:
	@test -n "$(MAIL)$(NICK)" || (echo "вкажи гравця: make d-user MAIL=пошта"; exit 1)
	$(PRODDB) $(BUN) scripts/dev-user.mjs $(if $(MAIL),--email $(MAIL),--nickname $(NICK))

d-db:
	$(PRODDB) psql "$$DATABASE_URL"
