-- FX en modo manual (openspec add-manual-conversions, tarea 2.4; design.md decisiones 5–6 y § Modelo de datos;
-- docs/08 §5.10 y §10.3). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * fx.currency              datos de referencia adicionales (EUR, USDC, TRX) + escala INMUTABLE (trigger).
--   * fx.workspace_currency    WS: monedas habilitadas por workspace (BOB, USD, USDT al crear el workspace).
--   * fx.exchange_rate         WS+G, APPEND-ONLY (INV-011): SELECT/INSERT para pf_app, sin UPDATE/DELETE. Corrección =
--                              fila nueva con `supersedes_id` (único parcial: una versión se reemplaza una sola vez).
--   * fx.rate_preference       WS: tipo de tasa preferido por par (FR-FX-006) + fx.rate_preference_set (versión de la
--                              lista completa para If-Match; la lista vacía también tiene versión).
-- Sin FKs cross-schema salvo workspace → iam.workspace y moneda → fx.currency (NFR-DATA-015).

-- migrate:up

-- ---------------------------------------------------------------- catálogo: datos de referencia (idempotente)
INSERT INTO fx.currency (code, kind, name, scale, symbol, iso_numeric) VALUES
  ('EUR', 'FIAT', 'Euro', 2, '€', '978'),
  ('USDC', 'CRYPTO', 'USD Coin', 6, NULL, NULL),
  ('TRX', 'CRYPTO', 'TRON', 6, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- FR-FX-001: la escala de una moneda no cambia una vez usada. En Phase 1 el catálogo son datos de referencia de solo
-- lectura para la aplicación y toda moneda sembrada se considera usada: la escala es inmutable para cualquier rol
-- (RLS FORCE impide al propietario ver las referencias por workspace, así que la regla no depende de contarlas).
CREATE FUNCTION fx.forbid_scale_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scale IS DISTINCT FROM OLD.scale THEN
    RAISE EXCEPTION 'the scale of currency % is immutable (% → %)', OLD.code, OLD.scale, NEW.scale
      USING ERRCODE = '23514', CONSTRAINT = 'currency_scale_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER currency_scale_immutable BEFORE UPDATE OF scale ON fx.currency
  FOR EACH ROW EXECUTE FUNCTION fx.forbid_scale_change();
REVOKE ALL ON FUNCTION fx.forbid_scale_change() FROM PUBLIC;

-- ---------------------------------------------------------------- fx.workspace_currency
CREATE TABLE fx.workspace_currency (
  workspace_id   uuid        NOT NULL REFERENCES iam.workspace (id),
  currency_code  varchar(16) NOT NULL REFERENCES fx.currency (code),
  display_symbol text        NULL CHECK (display_symbol IS NULL OR length(display_symbol) BETWEEN 1 AND 8),
  sort_order     integer     NOT NULL DEFAULT 0,
  enabled_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, currency_code)
);
COMMENT ON TABLE fx.workspace_currency IS
  'Monedas habilitadas por workspace (fx/market-rates). Un workspace sin filas usa el conjunto por defecto BOB/USD/USDT.';

-- ---------------------------------------------------------------- fx.exchange_rate
CREATE TABLE fx.exchange_rate (
  id               uuid           PRIMARY KEY,
  workspace_id     uuid           NULL REFERENCES iam.workspace (id),
  base_currency    varchar(16)    NOT NULL REFERENCES fx.currency (code),
  quote_currency   varchar(16)    NOT NULL REFERENCES fx.currency (code),
  rate             numeric(38,18) NOT NULL CHECK (rate > 0),
  rate_type        text           NOT NULL CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM')),
  as_of            timestamptz    NOT NULL,
  as_of_date       date           NOT NULL,
  source           text           NOT NULL CHECK (source IN ('MANUAL', 'PROVIDER', 'USER_CONVERSION')),
  source_label     text           NULL CHECK (source_label IS NULL OR length(source_label) BETWEEN 1 AND 200),
  provider         text           NULL,
  supersedes_id    uuid           NULL,
  supersede_reason text           NULL CHECK (supersede_reason IS NULL OR length(supersede_reason) BETWEEN 3 AND 500),
  created_at       timestamptz    NOT NULL DEFAULT now(),
  created_by       uuid           NULL,
  CONSTRAINT exchange_rate_pair_ck CHECK (base_currency <> quote_currency),
  CONSTRAINT exchange_rate_supersede_reason_ck CHECK ((supersedes_id IS NULL) = (supersede_reason IS NULL)),
  CONSTRAINT exchange_rate_global_provider_ck CHECK (workspace_id IS NOT NULL OR source = 'PROVIDER'),
  CONSTRAINT exchange_rate_ws_id_uk UNIQUE (workspace_id, id),
  -- Una versión solo reemplaza a otra del MISMO workspace.
  CONSTRAINT exchange_rate_supersedes_fk FOREIGN KEY (workspace_id, supersedes_id)
    REFERENCES fx.exchange_rate (workspace_id, id)
);
-- design.md decisión 5: reemplazo de un solo nivel por versión (FX_RATE_ALREADY_SUPERSEDED).
CREATE UNIQUE INDEX exchange_rate_supersedes_uk ON fx.exchange_rate (supersedes_id) WHERE supersedes_id IS NOT NULL;
-- "Tasa vigente a la fecha X" por workspace y para tasas globales.
CREATE INDEX exchange_rate_ws_pair_asof_idx ON fx.exchange_rate (workspace_id, base_currency, quote_currency, as_of DESC);
CREATE INDEX exchange_rate_pair_asof_idx ON fx.exchange_rate (base_currency, quote_currency, as_of DESC);
COMMENT ON TABLE fx.exchange_rate IS
  'Tasas históricas inmutables (INV-011): 1 base = rate quote. Append-only; corregir = nueva fila con supersedes_id.';

-- Segunda barrera del dominio: la versión que reemplaza conserva par, tipo y vigencia de la reemplazada.
CREATE FUNCTION fx.assert_supersede_consistency() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_old fx.exchange_rate%ROWTYPE;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_old FROM fx.exchange_rate WHERE id = NEW.supersedes_id;
  IF NOT FOUND OR v_old.base_currency <> NEW.base_currency OR v_old.quote_currency <> NEW.quote_currency
     OR v_old.rate_type <> NEW.rate_type OR v_old.as_of <> NEW.as_of THEN
    RAISE EXCEPTION 'rate % must keep pair, type and as_of of the superseded rate %', NEW.id, NEW.supersedes_id
      USING ERRCODE = '23514', CONSTRAINT = 'exchange_rate_supersede_consistency_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER exchange_rate_supersede_consistency BEFORE INSERT ON fx.exchange_rate
  FOR EACH ROW EXECUTE FUNCTION fx.assert_supersede_consistency();
REVOKE ALL ON FUNCTION fx.assert_supersede_consistency() FROM PUBLIC;

-- ---------------------------------------------------------------- fx.rate_preference (+ versión de la lista)
CREATE TABLE fx.rate_preference (
  workspace_id   uuid        NOT NULL REFERENCES iam.workspace (id),
  base_currency  varchar(16) NOT NULL REFERENCES fx.currency (code),
  quote_currency varchar(16) NOT NULL REFERENCES fx.currency (code),
  rate_type      text        NOT NULL CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM')),
  version        integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, base_currency, quote_currency),
  CONSTRAINT rate_preference_pair_ck CHECK (base_currency <> quote_currency)
);
-- Un par tiene una sola preferencia, en cualquier orientación.
CREATE UNIQUE INDEX rate_preference_unordered_pair_uk ON fx.rate_preference
  (workspace_id, LEAST(base_currency, quote_currency), GREATEST(base_currency, quote_currency));

CREATE TABLE fx.rate_preference_set (
  workspace_id uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  version      integer     NOT NULL CHECK (version >= 1),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE fx.rate_preference_set IS
  'Versión (ETag/If-Match) de la lista completa de preferencias del workspace; sin fila = versión 1.';

-- ---------------------------------------------------------------- RLS y grants
ALTER TABLE fx.workspace_currency ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.workspace_currency FORCE ROW LEVEL SECURITY;
ALTER TABLE fx.exchange_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.exchange_rate FORCE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_preference FORCE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_preference_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_preference_set FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON fx.workspace_currency TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON fx.rate_preference TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON fx.rate_preference_set TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
-- docs/08 §10.3: filas globales (providers) + propias; la aplicación solo inserta tasas de su workspace.
CREATE POLICY exchange_rate_read ON fx.exchange_rate FOR SELECT TO pf_app
  USING (workspace_id IS NULL OR workspace_id = platform.current_workspace_id());
CREATE POLICY exchange_rate_insert_own ON fx.exchange_rate FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON fx.workspace_currency, fx.exchange_rate, fx.rate_preference, fx.rate_preference_set FROM PUBLIC;
REVOKE ALL ON fx.workspace_currency, fx.exchange_rate, fx.rate_preference, fx.rate_preference_set
  FROM pf_app, pf_worker;
GRANT SELECT, INSERT ON fx.workspace_currency TO pf_app;
GRANT SELECT, INSERT ON fx.exchange_rate TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fx.rate_preference TO pf_app;
GRANT SELECT, INSERT, UPDATE ON fx.rate_preference_set TO pf_app;

-- migrate:down
DROP TABLE fx.rate_preference_set;
DROP TABLE fx.rate_preference;
DROP TRIGGER exchange_rate_supersede_consistency ON fx.exchange_rate;
DROP FUNCTION fx.assert_supersede_consistency();
DROP TABLE fx.exchange_rate;
DROP TABLE fx.workspace_currency;
DROP TRIGGER currency_scale_immutable ON fx.currency;
DROP FUNCTION fx.forbid_scale_change();
DELETE FROM fx.currency WHERE code IN ('EUR', 'USDC', 'TRX');
