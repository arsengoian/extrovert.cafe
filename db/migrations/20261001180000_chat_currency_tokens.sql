-- migrate:up

-- Сповіщення в чаті кавенятка — з «+» біля зарахованого й валютою-символом
-- (власник, 01.10.2026). Нові пише lib/notify.js (credit), а чат малює токен
-- :gold: / :silver: / :bean: іконкою. Тут — уже надіслані, щоб стрічка не
-- була наполовину словами: ті самі шаблони, що були в коді до цього дня.
-- Те, що з шаблоном не збігається, лишається як є.

create function pg_temp.tokens(body text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(body,
    'Тобі переказали (\d+) жовтих монет\.', 'Тобі переказали монети: +\1 :gold:.'),
    'Оплата пройшла: \+(\d+) монет\.', 'Оплата пройшла: +\1 :gold:.'),
    'Хтось перейшов за твоїм посиланням — нараховано (\d+) срібних за пост\.', 'Хтось перейшов за твоїм посиланням: +\1 :silver: за пост.'),
    '(Тримай|Повернуто) (\d+) (зерно|зерна|зерен)', '\1 +\2 :bean:')
$$;

update chat_messages set body = pg_temp.tokens(body)
 where role = 'system' and body <> pg_temp.tokens(body);
update pending_notices set body = pg_temp.tokens(body)
 where body <> pg_temp.tokens(body);

-- Продаж на маркеті: валюта лота в тексті не писалась — беремо її з угоди
-- того самого продавця на ту саму суму, найближчої за часом.
update chat_messages m
   set body = regexp_replace(m.body, 'продано на маркеті: \+(\d+) після комісії',
       'продано на маркеті: +\1 ' || coalesce((
         select case when t.currency = 'beans' then ':bean:' else ':gold:' end
           from market_trades t
          where t.seller_id = m.user_id
            and t.net = (substring(m.body from 'маркеті: \+(\d+) після'))::int
          order by abs(extract(epoch from t.created_at - m.created_at))
          limit 1), ':gold:') || ' після комісії')
 where m.role = 'system' and m.body ~ 'продано на маркеті: \+\d+ після комісії';

-- migrate:down

-- Назад — словами. Відмінок зерен не відновити, тож усюди «зерен».
create function pg_temp.words(body text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(body,
    'Тобі переказали монети: \+(\d+) :gold:\.', 'Тобі переказали \1 жовтих монет.'),
    'Оплата пройшла: \+(\d+) :gold:\.', 'Оплата пройшла: +\1 монет.'),
    'Хтось перейшов за твоїм посиланням: \+(\d+) :silver: за пост\.', 'Хтось перейшов за твоїм посиланням — нараховано \1 срібних за пост.'),
    '(Тримай|Повернуто) \+(\d+) :bean:', '\1 \2 зерен'),
    'продано на маркеті: \+(\d+) :(gold|bean): після комісії', 'продано на маркеті: +\1 після комісії')
$$;

update chat_messages set body = pg_temp.words(body)
 where role = 'system' and body <> pg_temp.words(body);
update pending_notices set body = pg_temp.words(body)
 where body <> pg_temp.words(body);
