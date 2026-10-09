-- migrate:up

-- Знижка в кав'ярні стає знижкою на один напій (власник, 08.10.2026). Машина
-- Jetinno міняє ціну окремо на кожен напій (priceset), а власна знижка в неї
-- одна на всі напої, тож «−X ₴ з усього» на машину не лягає; натомість
-- гравець обирає напій, і знижка діє лише на нього, закінчуючись першим
-- чеком саме з ним (docs/gamification_economy.md, «Знижка в кав'ярні»).
--
-- drink_slot null — стара знижка на всі напої (історія лишається валідною);
-- нові завжди з напоєм. FK на drinks.slot: напій має існувати в меню.
alter table point_discounts
    add column drink_slot text references drinks (slot);

-- migrate:down

alter table point_discounts drop column drink_slot;
