-- migrate:up

-- Репост стає рядком ще до того, як його зарахували: гравцю видається
-- посилання, і тільки перший чужий перехід за ним перетворює спробу на
-- нарахування. Тому потрібні дата створення й мережа, якої ми на момент
-- видачі посилання ще не знаємо (дізнаємось із Referer першого переходу,
-- а часто не дізнаємось узагалі).
alter table repost_verifications
    alter column network drop not null,
    add column created_at timestamptz not null default now();

create index on repost_verifications (user_id) where verified_at is null;

-- migrate:down
drop index repost_verifications_user_id_idx;
alter table repost_verifications
    drop column created_at,
    alter column network set not null;
