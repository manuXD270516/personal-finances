-- Stand-in migration (dbmate would run in the real finance-api image).
CREATE SCHEMA IF NOT EXISTS spike;
CREATE TABLE IF NOT EXISTS spike.migration_marker (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO spike.migration_marker(version) VALUES ('001') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS spike.persist_probe (id serial PRIMARY KEY, note text, created_at timestamptz DEFAULT now());
