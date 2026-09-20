-- Init-скрипт постгреса робить рівно те, чого не може міграція: заводить
-- окремі бази. Схема нашої бази сюди не лізе - вона в db/migrations і
-- накочується dbmate (docs/db-schema.md §6). Раніше тут лежала "мінімальна
-- схема" з points/receipts/accounts/plants; вона суперечила міграціям і
-- видалена 20.09.2026.
SELECT 'CREATE DATABASE glitchtip'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip') \gexec
