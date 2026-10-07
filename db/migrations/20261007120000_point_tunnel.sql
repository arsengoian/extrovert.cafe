-- migrate:up

-- Зворотний ssh-тунель малини до дроплета (власник, 07.10.2026). Точка за
-- мобільним NAT, і достукатись до неї можна було лише з Wi-Fi кав'ярні:
-- блекаут 06.10.2026 лишив малину без зв'язку, і подивитись, що з нею, з
-- іншого місця було неможливо. Тепер малина сама тримає з'єднання до
-- дроплета й відкриває на його loopback свій порт (raspberry-pi.md,
-- «Тунель»).
--
-- tunnel_pubkey малина генерує й реєструє сама (POST /points/:id/tunnel під
-- ключем точки), а cron на дроплеті переносить ключі звідси в
-- authorized_keys користувача pitunnel — з обмеженням лише на свій порт.
-- tunnel_port — порт на 127.0.0.1 дроплета, один на точку.
--
-- Порт = 22000 + номер малини. Точок, а з ними й малин, може бути багато, і
-- кожна тримає свій тунель одночасно з іншими: свій порт, свій ключ, а ключ
-- пускає лише на свій порт. kyiv-01 — малина №1 (власник, 07.10.2026);
-- наступна точка отримає 22002 при першій реєстрації ключа.
alter table points
    add column tunnel_port    int unique check (tunnel_port between 22001 and 22999),
    add column tunnel_pubkey  text,
    add column tunnel_key_at  timestamptz;

update points set tunnel_port = 22001 where id = 'kyiv-01';

-- migrate:down

alter table points
    drop column tunnel_key_at,
    drop column tunnel_pubkey,
    drop column tunnel_port;
