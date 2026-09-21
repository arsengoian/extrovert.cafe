// Пул Postgres живе в спільній бібліотеці: api, scheduler, checkbox і
// overseer ходять у ту саму базу з тими самими парсерами типів, і копій
// цього файла бути не повинно.
export { pool, query, one, many, tx } from "@extrovert/lib/db.js";
