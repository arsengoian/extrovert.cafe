-- migrate:up

-- Бонусні позиції — у форматі «Бонус-американо» (власник, 28.09.2026):
-- коротше за «Американо з бонусами», вміщається в картку кіоска й одразу
-- читається як окремий товар за монети. Номери позицій ті самі, тож чеки
-- й бонуси, що на них посилаються, нічого не помічають.
update drinks set name = 'Бонус-еспресо'   where slot = '901';
update drinks set name = 'Бонус-американо' where slot = '902';
update drinks set name = 'Бонус-капучино'  where slot = '903';
update drinks set name = 'Бонус-лате'      where slot = '904';

-- migrate:down

update drinks set name = 'Еспресо з бонусами'   where slot = '901';
update drinks set name = 'Американо з бонусами' where slot = '902';
update drinks set name = 'Капучино з бонусами'  where slot = '903';
update drinks set name = 'Лате з бонусами'      where slot = '904';
