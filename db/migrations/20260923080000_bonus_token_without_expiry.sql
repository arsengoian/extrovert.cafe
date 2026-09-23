-- Токен бонусу більше не згоряє: дві хвилини стосуються лише того, скільки
-- QR висить на екрані кіоска, а сам бонус можна забрати хоч через півроку
-- після того, як людина сфотографувала код (рішення власника 23.09.2026).
-- Тому колонка перейменована: expires_at читалось як «строк дії токена» —
-- саме так його й перевіряв редім.

-- migrate:up
alter table bonus_grants rename column expires_at to show_until;
alter index bonus_grants_status_expires_at_idx rename to bonus_grants_status_show_until_idx;

-- Статус «expired» теж більше не про токен: нічого не протухає.
update bonus_grants set status = 'pending' where status = 'expired';
alter table bonus_grants drop constraint bonus_grants_status_check;
alter table bonus_grants add constraint bonus_grants_status_check
    check (status in ('pending', 'claimed', 'redeemed'));

-- migrate:down
alter table bonus_grants drop constraint bonus_grants_status_check;
alter table bonus_grants add constraint bonus_grants_status_check
    check (status in ('pending', 'claimed', 'redeemed', 'expired'));
alter index bonus_grants_status_show_until_idx rename to bonus_grants_status_expires_at_idx;
alter table bonus_grants rename column show_until to expires_at;
