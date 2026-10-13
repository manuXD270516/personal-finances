-- FX: pares de tasa configurables por workspace y providers de precios cripto (openspec add-crypto-rate-providers,
-- tarea 4.4; design.md § Plan de migración; docs/41 D220, D225–D230, D250). Expand, no destructiva. Se ejecuta con
-- `pf_migrator`.
--
--   * fx.rate_pair_list        WS: lista de pares automáticos del workspace (`mode` DEFAULT | CUSTOM + versión para
--                              If-Match). Sin fila = DEFAULT, versión 1 (la lista se deriva de las monedas habilitadas).
--   * fx.rate_pair             WS: pares de la lista explícita (solo en modo CUSTOM), con su orden. Quitar un par solo
--                              borra aquí: nunca toca fx.exchange_rate (INV-011, D230).
--   * fx.provider_history_point  INSTALACIÓN (sin workspace_id ni datos de usuario, como fx.provider_run): caché de los
--                              cierres diarios que publican los providers cripto, pedida con rangos fijos de la
--                              instalación (FR-FX-015); cada workspace copia de aquí los cierres de sus pares.
--   * fx.exchange_rate / fx.rate_preference / txn.conversion_detail  se AMPLÍAN los CHECK de tipo de tasa con `MARKET`
--     (D226; las filas existentes siguen siendo válidas) y el de `provider` con los ids cripto `CRYPTO_<NOMBRE>` (los
--     ids reales se fijan en ADR-0029 tras verificar los términos de uso de cada fuente; la aplicación decide cuáles se
--     habilitan, la BD solo exige la forma).
--   * fx.provider_run          mismo CHECK de `provider` ampliado.
-- Los CHECK ampliados se agregan NOT VALID y se validan aparte (expand sin bloqueos largos). `pf_worker` es miembro de
-- `pf_app` y hereda sus grants y políticas: lee la lista de pares del workspace con la política de `pf_app`.

-- migrate:up

-- ---------------------------------------------------------------- fx.rate_pair_list / fx.rate_pair
CREATE TABLE fx.rate_pair_list (
  workspace_id uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  mode         text        NOT NULL CHECK (mode IN ('DEFAULT', 'CUSTOM')),
  version      integer     NOT NULL CHECK (version >= 1),
  updated_by   uuid        NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE fx.rate_pair_list IS
  'Modo y versión (ETag/If-Match) de la lista de pares de tasa automáticos del workspace; sin fila = DEFAULT, versión 1.';

CREATE TABLE fx.rate_pair (
  workspace_id   uuid        NOT NULL REFERENCES iam.workspace (id),
  base_currency  varchar(16) NOT NULL REFERENCES fx.currency (code),
  quote_currency varchar(16) NOT NULL REFERENCES fx.currency (code),
  sort_order     smallint    NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (workspace_id, base_currency, quote_currency),
  CONSTRAINT rate_pair_distinct_ck CHECK (base_currency <> quote_currency),
  CONSTRAINT rate_pair_sort_order_uk UNIQUE (workspace_id, sort_order)
);
COMMENT ON TABLE fx.rate_pair IS
  'Pares de la lista explícita (modo CUSTOM) de un workspace: 1 base = X quote, quote = moneda base o USDT (D227). Quitar uno no toca fx.exchange_rate.';

ALTER TABLE fx.rate_pair_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_pair_list FORCE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_pair ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_pair FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON fx.rate_pair_list TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON fx.rate_pair TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
REVOKE ALL ON fx.rate_pair_list, fx.rate_pair FROM PUBLIC;
REVOKE ALL ON fx.rate_pair_list, fx.rate_pair FROM pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON fx.rate_pair_list TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fx.rate_pair TO pf_app;

-- Purga del workspace demo (ADR-0026) y registro de portabilidad: sin hijas que las referencien (orden 160, como
-- fx.rate_preference).
SELECT platform.register_workspace_scoped_table('fx.rate_pair'::regclass, 160, 'DELETE');
SELECT platform.register_workspace_scoped_table('fx.rate_pair_list'::regclass, 160, 'DELETE');

-- ---------------------------------------------------------------- fx.provider_history_point (instalación)
CREATE TABLE fx.provider_history_point (
  provider       text            NOT NULL CHECK (provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$'),
  base_currency  varchar(16)     NOT NULL REFERENCES fx.currency (code),
  quote_currency varchar(16)     NOT NULL REFERENCES fx.currency (code),
  history_day    date            NOT NULL,
  -- Decimal exacto del cierre (NUMERIC como el de fx.exchange_rate.rate; nunca punto flotante).
  close_value    numeric(38, 18) NOT NULL CHECK (close_value > 0),
  close_at       timestamptz     NOT NULL,
  fetched_at     timestamptz     NOT NULL,
  raw_payload    text            NOT NULL CHECK (length(raw_payload) <= 1048576),
  PRIMARY KEY (provider, base_currency, quote_currency, history_day),
  CONSTRAINT provider_history_point_pair_ck CHECK (base_currency <> quote_currency)
);
COMMENT ON TABLE fx.provider_history_point IS
  'Caché de INSTALACIÓN (sin workspace_id ni datos de usuario) de los cierres diarios UTC de los providers cripto, pedida con rangos fijos de la instalación (FR-FX-015).';

ALTER TABLE fx.provider_history_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.provider_history_point FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_history_point_read ON fx.provider_history_point FOR SELECT TO pf_worker USING (true);
CREATE POLICY provider_history_point_write ON fx.provider_history_point FOR INSERT TO pf_worker WITH CHECK (true);
REVOKE ALL ON fx.provider_history_point FROM PUBLIC;
REVOKE ALL ON fx.provider_history_point FROM pf_app, pf_worker;
GRANT SELECT, INSERT ON fx.provider_history_point TO pf_worker;

-- ---------------------------------------------------------------- tipo de tasa MARKET y providers cripto
ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET')) NOT VALID;
ALTER TABLE fx.exchange_rate VALIDATE CONSTRAINT exchange_rate_rate_type_check;

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_provider_ck;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_provider_ck
  CHECK (provider IS NULL OR provider IN ('PARALELO_BO', 'DOLARAPI_BO') OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$') NOT VALID;
ALTER TABLE fx.exchange_rate VALIDATE CONSTRAINT exchange_rate_provider_ck;

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET')) NOT VALID;
ALTER TABLE fx.rate_preference VALIDATE CONSTRAINT rate_preference_rate_type_check;

ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET')) NOT VALID;
ALTER TABLE txn.conversion_detail VALIDATE CONSTRAINT conversion_detail_reference_rate_type_check;

ALTER TABLE fx.provider_run DROP CONSTRAINT provider_run_provider_check;
ALTER TABLE fx.provider_run ADD CONSTRAINT provider_run_provider_check
  CHECK (provider IN ('PARALELO_BO', 'DOLARAPI_BO') OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$') NOT VALID;
ALTER TABLE fx.provider_run VALIDATE CONSTRAINT provider_run_provider_check;

-- migrate:down
-- Solo revierte si no hay filas con MARKET ni providers cripto (fx.exchange_rate es append-only: no se borran tasas).
ALTER TABLE fx.provider_run DROP CONSTRAINT provider_run_provider_check;
ALTER TABLE fx.provider_run ADD CONSTRAINT provider_run_provider_check
  CHECK (provider IN ('PARALELO_BO', 'DOLARAPI_BO'));

ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_provider_ck;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_provider_ck
  CHECK (provider IS NULL OR provider IN ('PARALELO_BO', 'DOLARAPI_BO'));

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

DROP TABLE fx.provider_history_point;
DELETE FROM platform.workspace_scoped_table
  WHERE schema_name = 'fx' AND table_name IN ('rate_pair', 'rate_pair_list');
DROP TABLE fx.rate_pair;
DROP TABLE fx.rate_pair_list;
