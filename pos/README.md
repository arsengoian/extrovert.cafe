# pos — меню точки

Дані меню й заливка їх у R2. Ніякого сервера тут немає: кіоск (`raspberry/kiosk/`)
читає меню прямо з публічного бакета, а не через наш API.

```
data/menu-chrome.json    оформлення меню: тема, бренд, стакани, акція
scripts/push-prices.mjs  збирає меню з таблиці drinks і заливає в R2
scripts/push-release.mjs заливка релізу кіоска (архів, потім маніфест)
```

## Заливка меню

```bash
make prices-push                       # kyiv-01
bun pos/scripts/push-prices.mjs kyiv-02   # інша точка
bun pos/scripts/push-prices.mjs --dry     # показати меню, нічого не заливати
```

**Напої беруться з бази** — таблиця `drinks`, активні, у порядку
`sort_order`. Правити їх треба там (сід `db/seeds/drinks.json`,
`bun run seed:apply --table drinks --apply`), а не тут: файл поруч із тими
самими напоями означав би два списки, які розходяться (`../docs/db-schema.md`
§7). З кореня, а не з `pos/`, — щоб ключі до R2 бралися з єдиного `.env`.

Ключ у бакеті — `points/<point>/menu.json`, публічна адреса —
`https://pos.extrovert.cafe/points/<point>/menu.json` (`../docs/urls.md`).

Коли зʼявиться адмінка, ціни котитиме вона (`../docs/services.md` §4), а цей
скрипт лишиться тим, чим і є: способом залити меню руками, коли адмінки ще
немає або коли треба обійти її.

## Чому просто бакет, а не API

Меню публічне за визначенням — воно висить на екрані в коридорі. Ставити
перед ним Worker означало б тримати код там, де достатньо статичного файла:
Cloudflare і так віддає його з кеша, з `ETag` і `Range`. Тому кіоску не
потрібен ні токен, ні наш бекенд, щоб показати ціни (`../docs/services.md` §3).

Ціни в каталозі Checkbox звіряє окремий скрипт —
`backend/checkbox/scripts/sync-prices.mjs` (`../docs/checkbox.md`).
