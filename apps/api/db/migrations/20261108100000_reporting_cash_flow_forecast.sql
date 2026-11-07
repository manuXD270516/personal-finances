-- REPORTING + NOTIFY: pronóstico de flujo de caja (openspec add-cash-flow-forecast, tareas 4.1; design.md § Plan de
-- migración y decisiones 12, 13 y 15; docs/62 D377–D389). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * reporting.cash_flow_shortfall_episode  WS: un episodio de riesgo de déficit por (workspace, moneda) mientras el riesgo
--       del calendario de 30 días es `HIGH`. Abre, sostiene y cierra el job `reporting.cash-flow-watch` (`pf_worker`); el índice
--       único parcial garantiza UN solo episodio abierto por moneda aunque dos réplicas del worker evalúen a la vez. Dato derivado
--       y reconstruible: sin auditoría (como los episodios de FX, docs/33 D92). Los cerrados con más de 400 días se purgan.
--   * reporting.spendable_setting            WS: ajustes del disponible (modo de horizonte y esenciales); sin fila = valores por
--       omisión (versión 1). Los cambia el OWNER por la API (`pf_app`).
--   * reporting.spendable_essential_category WS: lista de categorías esenciales del disponible (hasta 50); la valida el dominio
--       con el árbol de categorías (sin FK entre contextos: una categoría archivada deja de restar y se indica).
--   * notifications.user_setting.digest_frequency  Frecuencia del digest por email del usuario (`OFF` por omisión, FR-NOTIFY-007).
--   * pf_workspace_directory: + SELECT (min_liquidity_reserve_amount, min_liquidity_reserve_currency) en iam.workspace: el job
--     `reporting.cash-flow-watch` y el digest del worker leen la reserva mínima (umbral del riesgo de déficit) sin usuario.
-- Las tres tablas nuevas con `workspace_id`: RLS ENABLE + FORCE fail-closed (`platform.current_workspace_id()` lanza PF002 sin
-- contexto) y registro en `platform.workspace_scoped_table` (purga del workspace demo, ADR-0026). Sin backfill.

-- migrate:up

CREATE TABLE reporting.cash_flow_shortfall_episode (
  id                  uuid          PRIMARY KEY,
  workspace_id        uuid          NOT NULL REFERENCES iam.workspace (id),
  currency            varchar(16)   NOT NULL,
  opened_at           timestamptz   NOT NULL,
  closed_at           timestamptz   NULL,
  first_shortfall_date date         NOT NULL,
  lowest_amount       numeric       NOT NULL,
  lowest_date         date          NOT NULL,
  threshold_amount    numeric       NOT NULL,
  below_zero          boolean       NOT NULL,
  last_evaluated_at   timestamptz   NOT NULL,
  last_lowest_amount  numeric       NOT NULL,
  CONSTRAINT cash_flow_shortfall_episode_order_ck CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
-- Un solo episodio abierto por moneda (a prueba de dos réplicas del worker).
CREATE UNIQUE INDEX cash_flow_shortfall_episode_open_uk
  ON reporting.cash_flow_shortfall_episode (workspace_id, currency) WHERE closed_at IS NULL;
CREATE INDEX cash_flow_shortfall_episode_ws_ix
  ON reporting.cash_flow_shortfall_episode (workspace_id, opened_at DESC);
CREATE INDEX cash_flow_shortfall_episode_closed_ix
  ON reporting.cash_flow_shortfall_episode (closed_at) WHERE closed_at IS NOT NULL;
COMMENT ON TABLE reporting.cash_flow_shortfall_episode IS
  'Episodio de riesgo de déficit (calendario de flujo de caja) por moneda: abierto mientras el riesgo es HIGH; un solo episodio abierto por moneda (D381).';

CREATE TABLE reporting.spendable_setting (
  workspace_id        uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  horizon_mode        text        NOT NULL DEFAULT 'FINANCIAL_PERIOD'
                                  CHECK (horizon_mode IN ('FINANCIAL_PERIOD', 'NEXT_INCOME')),
  subtract_essentials boolean     NOT NULL DEFAULT false,
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE reporting.spendable_setting IS
  'Ajustes del disponible para gastar (Q5): modo de horizonte y esenciales presupuestados; sin fila = valores por omisión.';

CREATE TABLE reporting.spendable_essential_category (
  workspace_id uuid NOT NULL REFERENCES iam.workspace (id),
  category_id  uuid NOT NULL,
  PRIMARY KEY (workspace_id, category_id)
);
COMMENT ON TABLE reporting.spendable_essential_category IS
  'Categorías de gasto marcadas como esenciales para el disponible (Q5); lista propia de REPORTING (D378).';

-- RLS forzada (fail-closed con PF002 si falta el contexto).
ALTER TABLE reporting.cash_flow_shortfall_episode ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.cash_flow_shortfall_episode FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.spendable_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.spendable_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.spendable_essential_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.spendable_essential_category FORCE ROW LEVEL SECURITY;

-- Episodios: lectura por workspace (la API y, por herencia de `pf_app`, el worker); el worker abre, actualiza, cierra y purga.
CREATE POLICY shortfall_episode_read ON reporting.cash_flow_shortfall_episode FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY shortfall_episode_insert ON reporting.cash_flow_shortfall_episode FOR INSERT TO pf_worker
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY shortfall_episode_update ON reporting.cash_flow_shortfall_episode FOR UPDATE TO pf_worker
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY shortfall_episode_delete ON reporting.cash_flow_shortfall_episode FOR DELETE TO pf_worker
  USING (workspace_id = platform.current_workspace_id());

-- Ajustes y categorías esenciales: los lee todo miembro y los escribe la API (el OWNER lo exige el caso de uso).
CREATE POLICY spendable_setting_ws ON reporting.spendable_setting TO pf_app
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY spendable_essential_ws ON reporting.spendable_essential_category TO pf_app
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON reporting.cash_flow_shortfall_episode FROM PUBLIC, pf_app, pf_worker;
REVOKE ALL ON reporting.spendable_setting FROM PUBLIC, pf_app, pf_worker;
REVOKE ALL ON reporting.spendable_essential_category FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT ON reporting.cash_flow_shortfall_episode TO pf_app;
GRANT INSERT, UPDATE, DELETE ON reporting.cash_flow_shortfall_episode TO pf_worker;
GRANT SELECT, INSERT ON reporting.spendable_setting TO pf_app;
GRANT UPDATE (horizon_mode, subtract_essentials, version, updated_at) ON reporting.spendable_setting TO pf_app;
GRANT SELECT, INSERT, DELETE ON reporting.spendable_essential_category TO pf_app;

-- Purga del workspace demo (ADR-0026): después de `reporting.workspace_data_version` (170); sin FK entre ellas.
SELECT platform.register_workspace_scoped_table('reporting.cash_flow_shortfall_episode'::regclass, 171, 'DELETE');
SELECT platform.register_workspace_scoped_table('reporting.spendable_setting'::regclass, 172, 'DELETE');
SELECT platform.register_workspace_scoped_table('reporting.spendable_essential_category'::regclass, 173, 'DELETE');

-- Frecuencia del digest por email (D385: desactivado por omisión). La columna entra en la lista de UPDATE de `pf_app`.
ALTER TABLE notifications.user_setting
  ADD COLUMN digest_frequency text NOT NULL DEFAULT 'OFF'
  CONSTRAINT user_setting_digest_frequency_ck CHECK (digest_frequency IN ('OFF', 'WEEKLY', 'MONTHLY'));
GRANT UPDATE (digest_frequency) ON notifications.user_setting TO pf_app;

-- El worker (sin usuario) lee la reserva mínima de liquidez con el rol de directorio, como la zona y la moneda base.
GRANT SELECT (min_liquidity_reserve_amount, min_liquidity_reserve_currency) ON iam.workspace TO pf_workspace_directory;

-- migrate:down
REVOKE SELECT (min_liquidity_reserve_amount, min_liquidity_reserve_currency) ON iam.workspace FROM pf_workspace_directory;
REVOKE UPDATE (digest_frequency) ON notifications.user_setting FROM pf_app;
ALTER TABLE notifications.user_setting DROP COLUMN digest_frequency;
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'reporting'
   AND table_name IN ('cash_flow_shortfall_episode', 'spendable_setting', 'spendable_essential_category');
DROP TABLE reporting.spendable_essential_category;
DROP TABLE reporting.spendable_setting;
DROP TABLE reporting.cash_flow_shortfall_episode;
