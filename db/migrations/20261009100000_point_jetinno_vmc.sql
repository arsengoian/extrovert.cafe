-- migrate:up

-- Номер кавомашини точки в порталі Jetinno (власник, 09.10.2026). Потрібен,
-- щоб котити ціни на машину (ціль деплою jetinno) і знімати з неї телеметрію
-- та замовлення (docs/jetinno.md, «Скоуп інтеграції»). null — точці машина в
-- Jetinno не зіставлена, ціль jetinno їй не додається. kyiv-01 — 206946.
alter table points add column jetinno_vmc text;

update points set jetinno_vmc = '206946' where id = 'kyiv-01';

-- migrate:down

alter table points drop column jetinno_vmc;
