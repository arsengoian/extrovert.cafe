-- Акція більше не їде деплойментом (рішення власника 23.09.2026).
--
-- Деплоймент існує заради цін: вони зачіпають і машину, і Checkbox, тому
-- їх котять свідомо й видно, що саме поїхало. Акція ж — просто напис на
-- екрані: обрав поточну в адмінці, і вона там. Тому «поточна» — стан
-- акції, а не вміст payload.
--
-- Поточна завжди рівно одна: частковий унікальний індекс не дасть
-- поставити другу, а адмінка не дає зняти єдину.

-- migrate:up
alter table promos add column is_current boolean not null default false;
create unique index promos_one_current on promos (is_current) where is_current;

update promos set is_current = true
 where id = (select id from promos where archived_at is null order by created_at desc limit 1);

-- Коди з «x» ми вигадали самі (x034 «Американо з бонусами», x038): у
-- машині таких позицій немає, а нумерацію задає оператор — з літери
-- машини (a…, b…). Позицій у чеках із ними не було жодної.
delete from drinks where system_code like 'x%';

-- migrate:down
drop index promos_one_current;
alter table promos drop column is_current;
