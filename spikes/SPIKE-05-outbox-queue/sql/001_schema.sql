-- SPIKE-05 (descartable). Esquema mínimo: negocio + platform.outbox/inbox/dead_letter.
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS app;

-- Fila de negocio (escrita por la "API" en la misma tx que el outbox)
CREATE TABLE IF NOT EXISTS app.transaction (
  id               uuid PRIMARY KEY,
  account_id       uuid NOT NULL,
  account_version  int  NOT NULL,
  amount           numeric(38,18) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, account_version)
);

-- docs/11-domain-events.md §6
CREATE TABLE IF NOT EXISTS platform.outbox (
  id                uuid PRIMARY KEY,               -- = eventId (UUIDv7)
  sequence          bigserial UNIQUE NOT NULL,
  workspace_id      uuid NOT NULL,
  event_type        text NOT NULL,
  event_version     int  NOT NULL,
  aggregate_type    text NOT NULL,
  aggregate_id      uuid NOT NULL,
  aggregate_version int  NOT NULL,
  envelope          jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at      timestamptz,
  attempts          int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON platform.outbox (sequence) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.inbox (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE IF NOT EXISTS platform.dead_letter (
  consumer        text NOT NULL,
  event_id        uuid NOT NULL,
  envelope        jsonb NOT NULL,
  error           text,
  attempts        int NOT NULL,
  first_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_failed_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REPLAYED','DISCARDED')),
  PRIMARY KEY (consumer, event_id)
);

-- Efecto del consumidor (proyección de saldo) + bitácora para medir orden y duplicados
CREATE TABLE IF NOT EXISTS app.balance (
  account_id    uuid PRIMARY KEY,
  total         numeric(38,18) NOT NULL DEFAULT 0,
  last_version  int NOT NULL DEFAULT 0,
  applied_count int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app.applied (
  seq          bigserial PRIMARY KEY,
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  account_id   uuid NOT NULL,
  version      int NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Cada entrega física al handler (incluye duplicados filtrados por inbox)
CREATE TABLE IF NOT EXISTS app.delivery (
  seq       bigserial PRIMARY KEY,
  consumer  text NOT NULL,
  event_id  uuid NOT NULL,
  duplicate boolean NOT NULL,
  at        timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Despertador del relay (LISTEN/NOTIFY): se emite al COMMIT, una vez por tx (payload igual se colapsa)
CREATE OR REPLACE FUNCTION platform.outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS outbox_notify ON platform.outbox;
CREATE TRIGGER outbox_notify AFTER INSERT ON platform.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION platform.outbox_notify();
