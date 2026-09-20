-- migrate:up

-- Зерна мають два власні джерела, яких не було в переліку причин: подарунок
-- зібраного комплекту кавенятку (economy §3.4) і врожай на стадії 10 (§3.1).
-- Без них нарахування довелося б ховати під 'admin', і звіт «звідки зерна»
-- перестав би відповідати на своє питання.
alter table ledger_entries drop constraint ledger_entries_reason_check;
alter table ledger_entries add constraint ledger_entries_reason_check
    check (reason in (
        'purchase', 'quiz', 'repost', 'crate', 'care', 'chat',
        'transfer', 'market', 'exchange', 'pos_discount',
        'delivery', 'sapling', 'wardrobe_set', 'harvest', 'admin'));

-- migrate:down
alter table ledger_entries drop constraint ledger_entries_reason_check;
alter table ledger_entries add constraint ledger_entries_reason_check
    check (reason in (
        'purchase', 'quiz', 'repost', 'crate', 'care', 'chat',
        'transfer', 'market', 'exchange', 'pos_discount',
        'delivery', 'sapling', 'admin'));
