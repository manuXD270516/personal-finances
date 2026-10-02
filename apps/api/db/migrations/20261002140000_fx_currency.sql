-- Catálogo global de monedas `fx.currency` + datos de referencia (openspec add-workspace-identity, tareas 1.2/1.3;
-- docs/31 D24; docs/08 §5.10). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- Se adelanta a `add-manual-conversions` porque `iam.workspace.base_currency` la referencia por FK. Solo crea la
-- tabla y siembra BOB/USD/USDT/BTC/ETH; el comportamiento del catálogo (escala inmutable una vez usada, monedas
-- habilitadas por workspace, endpoints) lo especifica `fx/market-rates`, que reutiliza esta migración.
--
-- Tabla GLOBAL (sin workspace_id): está en la allowlist del chequeo de catálogo RLS (TC-SECURITY-RLS-004).
-- `pf_app` solo tiene SELECT; las monedas CUSTOM (owner_workspace_id) llegan con FX y su política con ellas.

-- migrate:up
CREATE SCHEMA IF NOT EXISTS fx;
GRANT USAGE ON SCHEMA fx TO pf_app;

CREATE TABLE IF NOT EXISTS fx.currency (
  code               varchar(16) PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{1,15}$'),
  kind               text        NOT NULL CHECK (kind IN ('FIAT', 'CRYPTO', 'COMMODITY', 'CUSTOM')),
  name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  scale              smallint    NOT NULL CHECK (scale BETWEEN 0 AND 18),
  symbol             text        NULL CHECK (symbol IS NULL OR length(symbol) BETWEEN 1 AND 8),
  iso_numeric        text        NULL CHECK (iso_numeric IS NULL OR iso_numeric ~ '^[0-9]{3}$'),
  owner_workspace_id uuid        NULL,
  is_active          boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currency_custom_owner CHECK ((kind = 'CUSTOM') = (owner_workspace_id IS NOT NULL))
);
COMMENT ON TABLE fx.currency IS
  'Catálogo global de monedas con su escala canónica (docs/08 §5.10). Global: sin RLS por workspace; pf_app solo lectura.';

INSERT INTO fx.currency (code, kind, name, scale, symbol, iso_numeric) VALUES
  ('BOB', 'FIAT', 'Boliviano', 2, 'Bs', '068'),
  ('USD', 'FIAT', 'US Dollar', 2, '$', '840'),
  ('USDT', 'CRYPTO', 'Tether USD', 6, '₮', NULL),
  ('BTC', 'CRYPTO', 'Bitcoin', 8, '₿', NULL),
  ('ETH', 'CRYPTO', 'Ether', 18, 'Ξ', NULL)
ON CONFLICT (code) DO NOTHING;

REVOKE ALL ON fx.currency FROM PUBLIC;
GRANT SELECT ON fx.currency TO pf_app;

-- migrate:down
DROP TABLE fx.currency;
DROP SCHEMA fx;
