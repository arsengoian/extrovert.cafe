-- migrate:up

-- Анкету профілю зберігаємо й незавершеною (власник, 01.10.2026: частково
-- заповнені опитування мають впливати на статистику, але лише заповненими
-- значеннями). Досі відповіді жили в чернетці на телефоні й летіли на
-- сервер одним запитом після шостого кроку — кинута на третьому кроці
-- анкета не лишала в базі нічого.
--
-- Тепер рядок з'являється з першим пройденим кроком і доповнюється далі;
-- completed_at — коли анкету надіслали цілком і нарахували монети. Порожній
-- completed_at означає «ще в процесі»: монет немає, а відповіді вже йдуть у
-- статистику адмінки (кожне питання рахується лише серед тих, хто на нього
-- відповів). Усі наявні рядки — завершені анкети.
alter table quiz_profile_responses add column completed_at timestamptz;
update quiz_profile_responses set completed_at = created_at;

-- migrate:down

delete from quiz_profile_responses where completed_at is null;
alter table quiz_profile_responses drop column completed_at;
