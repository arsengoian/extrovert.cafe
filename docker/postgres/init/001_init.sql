-- Мінімальна схема. Розширюємо в міру появи сервісів.
CREATE TABLE IF NOT EXISTS points (
  id          text PRIMARY KEY,               -- kyiv-01
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Чеки з ПРРО. raw лишаємо назавжди: формат Checkbox може змінитись,
-- а перерозібрати збережене дешевше, ніж просити повторну вигрузку.
CREATE TABLE IF NOT EXISTS receipts (
  id            uuid PRIMARY KEY,             -- receipt.id з Checkbox
  point_id      text REFERENCES points(id),
  fiscal_code   text,
  fiscal_date   timestamptz,
  total_sum     bigint,                       -- копійки, не float
  tax_url       text,
  raw           jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_point_date ON receipts (point_id, fiscal_date DESC);

CREATE TABLE IF NOT EXISTS accounts (
  id          bigserial PRIMARY KEY,
  handle      text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plants (
  id          bigserial PRIMARY KEY,
  account_id  bigint REFERENCES accounts(id),
  name        text,
  stage       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO points (id, title) VALUES ('kyiv-01', 'Київ, точка 1')
  ON CONFLICT (id) DO NOTHING;
