-- Bootstrap de plataforma (openspec bootstrap-platform-foundation, tarea 4.5; ARCHITECTURE §9).
-- Se ejecuta con el rol propietario `pf_migrator` (LOGIN, CREATEROLE, dueño de la base). En local lo crea el
-- init de postgres (deploy/compose/compose.yaml → configs.postgres-init); en cloud, la IaC.
--
-- Crea:
--   * rol `pf_app` (runtime de api/worker/seed): sin SUPERUSER, sin BYPASSRLS, sin CREATEDB/CREATEROLE y
--     sin privilegio CREATE en la base ni en ningún schema → no puede saltarse RLS ni ejecutar DDL.
--     Su contraseña NO vive aquí: la fija el comando `migrate` a partir de DATABASE_URL.
--   * schema `platform` (tablas transversales) y schema `pgboss` (cola; lo instala `migrate` con pg-boss).
--   * default privileges: todo objeto que `pf_migrator` cree después en esos schemas queda con DML para pf_app.

-- migrate:up
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_app') THEN
    CREATE ROLE pf_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  END IF;
  -- Ni PUBLIC ni pf_app pueden crear schemas en la base; pf_app solo se conecta.
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pf_app', current_database());
END
$$;

-- PG ≥ 15 ya no concede CREATE en `public` a PUBLIC; se fija explícitamente por si la base viene de otra versión.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA platform;
GRANT USAGE ON SCHEMA platform TO pf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT USAGE, SELECT ON SEQUENCES TO pf_app;

CREATE SCHEMA pgboss;
GRANT USAGE ON SCHEMA pgboss TO pf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO pf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT EXECUTE ON FUNCTIONS TO pf_app;

-- Registro de seeds aplicados (docs/19 §8: seeds idempotentes por `seed_run`).
CREATE TABLE platform.seed_run (
  profile         text        PRIMARY KEY CHECK (profile IN ('minimal', 'demo', 'large')),
  dataset_version integer     NOT NULL CHECK (dataset_version > 0),
  applied_at      timestamptz NOT NULL DEFAULT now()
);

-- Efecto idempotente del job de diagnóstico `platform.probe` (solo local/ci; TC-PLATFORM-STACK-006).
CREATE TABLE platform.diagnostic_probe (
  key          text        PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 200),
  job_id       text        NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE platform.diagnostic_probe;
DROP TABLE platform.seed_run;
DROP SCHEMA pgboss CASCADE;
DROP SCHEMA platform;
