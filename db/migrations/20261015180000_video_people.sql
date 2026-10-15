-- migrate:up

-- Відвідуваність із відео (власник, 15.10.2026; заміри — аналіз архіву
-- картки камери 09–14.10, docs/video.md «Люди й візити»). Подія вже не
-- лише «хтось біля кавʼярні»: воркер веде прохід кожної людини коридором,
-- з напрямком (зайшов у зал чи вийшов), вирізками й вектором зовнішності,
-- а окрема робота складає з проходів людей і візити.

-- ── Сегменти ────────────────────────────────────────────────────────────
-- analysis_version: якою версією аналізу оброблено сегмент. Нова версія
-- воркера переробляє старі сегменти, коли свіжих у черзі немає. Усе, що
-- оброблено до цієї міграції, — версія 1.
-- source: звідки відео. 'pi' — запис малини (безперервний), 'sd' — архів
-- картки самої камери (лише фрагменти з рухом), залитий окремо, коли
-- малина не писала.
alter table video_segments
    add column analysis_version smallint not null default 0,
    add column source text not null default 'pi'
        check (source in ('pi', 'sd'));
update video_segments set analysis_version = 1 where status = 'done';

-- ── Покриття записом ────────────────────────────────────────────────────
-- Коли камера могла когось побачити. Для малини це самі сегменти (вона пише
-- безперервно), а картка пише лише рух, і пауза між її фрагментами — це або
-- порожній коридор, або вимкнена камера. Імпорт картки знає різницю (новий
-- файл після ввімкнення) і записує сюди проміжки, коли камера працювала.
create table video_coverage (
    id          bigserial primary key,
    point_id    text not null references points (id),
    camera_id   text not null,
    source      text not null check (source in ('sd')),
    started_at  timestamptz not null,
    ended_at    timestamptz not null check (ended_at > started_at)
);
create index on video_coverage (point_id, started_at);

-- ── Люди й візити ──────────────────────────────────────────────────────
-- Людина — кластер проходів за зовнішністю (одяг), не довше 18 годин:
-- далі одяг уже не тримає ідентичність. Робота worker.people переписує
-- людей і візити за останні три доби щоразу заново, тож id людини — не
-- стабільний ключ, а номер у поточному розкладі.
create table video_people (
    id          bigserial primary key,
    point_id    text not null references points (id),
    first_seen  timestamptz not null,
    last_seen   timestamptz not null,
    passages    integer not null,
    staff       boolean not null default false,
    computed_at timestamptz not null default now()
);
create index on video_people (point_id, first_seen);

-- Візит: від входу в зал до виходу, перерви до 45 хв візит не рвуть. Будь-
-- який кінець може бути невідомим (null): вхід був до початку запису, вихід
-- припав на блекаут чи впізнавання не звело половинки.
create table video_visits (
    id          bigserial primary key,
    person_id   bigint not null references video_people (id) on delete cascade,
    point_id    text not null references points (id),
    entered_at  timestamptz,
    left_at     timestamptz,
    passages    integer not null
);
create index on video_visits (point_id, entered_at);
create index on video_visits (person_id);

-- ── Проходи ─────────────────────────────────────────────────────────────
-- Один трек людини (зшитий через розриви детектора й шви сегментів).
-- direction — геометрія за низом рамки: away (від камери), toward (до
-- камери), near, far, uturn, uturn_far. heading — що це значить на цій
-- точці (налаштування сцени): in (зайшов у зал), out (вийшов) або null.
-- points — стиснутий трек [[мс від started_at, x1, y1, x2, y2], ...] у
-- частках кадру; crops — ключі вирізок у extrovert-evidence; embedding —
-- середній вектор зовнішності (person-reidentification-retail-0277) з
-- вагою emb_weight, щоб злиття двох половинок було простим зважуванням.
create table video_passages (
    id               bigserial primary key,
    point_id         text not null references points (id),
    camera_id        text not null,
    segment_id       bigint references video_segments (id) on delete set null,
    analysis_version smallint not null,
    started_at       timestamptz not null,
    ended_at         timestamptz not null,
    direction        text not null
        check (direction in ('away', 'toward', 'near', 'far', 'uturn', 'uturn_far')),
    heading          text check (heading in ('in', 'out')),
    frames           integer not null,
    start_depth      real not null,
    end_depth        real not null,
    min_depth        real not null,
    max_depth        real not null,
    at_zone          boolean not null default false,
    at_machine       boolean not null default false,
    open_start       boolean not null default false,
    open_end         boolean not null default false,
    points           jsonb not null default '[]',
    crops            jsonb not null default '[]',
    embedding        real[],
    emb_weight       real not null default 0,
    person_id        bigint references video_people (id) on delete set null,
    receipt_id       bigint references receipts (id) on delete set null,
    receipt_match    text check (receipt_match in ('alone', 'ambiguous')),
    superseded_at    timestamptz
);
create index on video_passages (point_id, started_at);
create index on video_passages (segment_id);
create index on video_passages (person_id);
create index on video_passages (receipt_id) where receipt_id is not null;

-- ── Події ───────────────────────────────────────────────────────────────
-- machine: людина стоїть упритул до автомата лицем до нього (не просто
-- тупцює в коридорі біля камери) — кандидат у покупці.
-- superseded_at: подію замінив переаналіз сегмента. Старі події не
-- видаляємо, бо на них може посилатись redemptions.evidence_event_id.
alter table video_events drop constraint video_events_kind_check;
alter table video_events add constraint video_events_kind_check
    check (kind in ('approach', 'queue', 'pass', 'machine'));
alter table video_events
    add column camera_id text,
    add column analysis_version smallint not null default 0,
    add column passage_id bigint references video_passages (id) on delete set null,
    add column superseded_at timestamptz;
update video_events set analysis_version = 1;
create index on video_events (segment_id);

-- migrate:down

alter table video_events
    drop column superseded_at,
    drop column passage_id,
    drop column analysis_version,
    drop column camera_id;
delete from video_events where kind = 'machine';
alter table video_events drop constraint video_events_kind_check;
alter table video_events add constraint video_events_kind_check
    check (kind in ('approach', 'queue', 'pass'));
drop table video_passages;
drop table video_visits;
drop table video_people;
drop table video_coverage;
alter table video_segments drop column source, drop column analysis_version;
