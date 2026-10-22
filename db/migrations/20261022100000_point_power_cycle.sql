-- migrate:up

-- Перезавантаження малини живленням через розумну розетку Tuya (власник,
-- 22.10.2026; docs/raspberry-pi.md, «Перезавантаження живленням»).
-- 21.10.2026 сторож картки перезавантажив малину, але картка відпала з шини
-- зовсім («card removed»), а на Pi 1 живлення картки програмно не вимкнути:
-- після м'якого ребуту завантажувач її не бачив, і точка лежала до ранку.
-- Таке лікує лише знеструмлення — його робить overseer через хмару Tuya.
--
-- Той самий журнал, що й дозволи сторожу: kind розрізняє м'який ребут
-- (soft, просить сама малина) і вимкнення розетки (power, вирішує overseer).
-- Ліміти в кожного свої.
alter table point_reboots
    add column kind text not null default 'soft' check (kind in ('soft', 'power'));

-- ID пристрою Tuya, у який увімкнено живлення малини; null — розетки немає.
alter table points add column power_plug_id text;

-- migrate:down

alter table points drop column power_plug_id;
alter table point_reboots drop column kind;
