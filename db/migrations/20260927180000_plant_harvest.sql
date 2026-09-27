-- migrate:up

-- Сім зерен за врожай (gamification_economy.md §3.1): кущ, що вперше виріс
-- до стадії 10, віддає власнику 7 зерен — по одному на кожен посаджений
-- бутон. Тригер видачі був в економіці з 12.09.2026 і навіть мав свою
-- причину в журналі ('harvest'), але в коді переходу стадій його не було:
-- 26.09.2026 перший кущ на проді виріс, а зерен власник не отримав.
--
-- harvest_at — коли врожай виплачено. Один раз на кущ, а не на власника
-- чи цикл: подарований або куплений дорослий кущ удруге не платить
-- (рішення власника 27.09.2026: «боби даруються, коли кавенятко вперше
-- виростає»).
alter table plants add column harvest_at timestamptz;
comment on column plants.harvest_at is 'Коли виплачено 7 зерен за перший повний ріст; null — ще не виріс або виріс до цього поля';

-- Доплата тим, хто вже виріс до цієї міграції. Сім — число з економіки
-- (economy.json, harvest.beans) на 27.09.2026; тут воно зашите, бо це
-- разова доплата, а не правило.
with grown as (
  update plants set harvest_at = now(), lifetime_beans_gifted = lifetime_beans_gifted + 7
   where growth_stage >= 10 and harvest_at is null
   returning id, owner_id
), paid as (
  update users u set beans = u.beans + 7 * g.n
    from (select owner_id, count(*)::int as n from grown group by owner_id) g
   where u.id = g.owner_id
   returning u.id
)
insert into ledger_entries (user_id, delta_beans, reason, meta)
select owner_id, 7, 'harvest', jsonb_build_object('plant_id', id, 'backfill', true) from grown;

-- migrate:down
alter table plants drop column harvest_at;
