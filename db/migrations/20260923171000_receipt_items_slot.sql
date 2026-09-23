-- Номер позиції в рядку чека.
--
-- У `receipt_items.system_code` лежить те, що написала каса, — код разом із
-- літерою машини («a024»). Це запис факту, і міняти його не можна. Але всі
-- з'єднання з каталогом («який це напій») мають іти по номеру, інакше з
-- другою машиною той самий напій перестане знаходитись.

-- migrate:up
alter table receipt_items add column slot text;
comment on column receipt_items.slot is
    'Номер позиції без літери машини: саме по ньому шукається drinks.slot';

update receipt_items set slot = substring(system_code from 2)
 where system_code ~ '^[a-z][0-9]+$';
update receipt_items set slot = system_code where slot is null;

create index on receipt_items (slot);

-- migrate:down
drop index receipt_items_slot_idx;
alter table receipt_items drop column slot;
