-- Bootstrap (equivale a IaC): roles creados FUERA de las migraciones de la app.
-- Credenciales solo para el spike local.
CREATE ROLE pf_migrator LOGIN PASSWORD 'spike-only-migrator' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE ROLE pf_app      LOGIN PASSWORD 'spike-only-app'      NOSUPERUSER NOBYPASSRLS NOCREATEROLE;

ALTER DATABASE pf_spike OWNER TO pf_migrator;
-- PG15+: public ya no es CREATE para PUBLIC; el migrator es owner de la BD y crea sus schemas.
REVOKE ALL ON DATABASE pf_spike FROM PUBLIC;
GRANT CONNECT ON DATABASE pf_spike TO pf_app;
