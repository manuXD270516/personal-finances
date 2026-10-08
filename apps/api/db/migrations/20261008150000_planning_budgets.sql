-- PLANNING: presupuestos (openspec add-budgets, tarea 4.1; design.md § Modelo de datos y decisiones 1-3, 8 y 10;
-- docs/08 §5.6; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * planning.budget                    WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: el plan sigue al periodo).
--     UNIQUE (workspace_id, period_id): un plan por periodo (árbitro de `ON CONFLICT DO NOTHING`). `currency` es la
--     moneda base del workspace al crear el plan (docs/33 D78/D79): la columna permite relajar la unicidad a
--     (periodo, moneda) con un expand si el owner pide planes multi-moneda.
--   * planning.budget_line               WS: SELECT/INSERT/UPDATE/DELETE (las líneas son configuración del plan, no
--     hechos financieros; su historia está en el audit log). UNIQUE (plan, tipo de objetivo, objetivo). CHECKs de
--     forma por tipo (FIXED/MAXIMUM: planificado; MINIMUM: mínimo; RANGE: mínimo <= máximo; PERCENT_OF_INCOME: % y
--     base), montos >= 0, <= 10 umbrales, ingresos solo FIXED sin umbrales ni rollover. SIN columnas de gastado
--     (INV-034): el gastado se deriva de las transacciones en cada lectura.
--   * planning.budget_threshold_crossing WS-RO: SELECT/INSERT para pf_app (y pf_worker, que lo hereda); append-only con
--     `platform.forbid_mutation()` (docs/31 D19; la purga del workspace demo sigue permitida, ADR-0026). PK
--     (workspace, periodo, tipo de objetivo, objetivo, umbral): el dedupe de "una sola vez" es por OBJETIVO, no por línea.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): cruces y líneas antes que el plan,
--     y el plan antes que el periodo (160).
-- Sin backfill.

-- migrate:up
CREATE SCHEMA IF NOT EXISTS planning;

-- Clave compuesta del periodo para las FKs (workspace, id): ya existe `financial_period_ws_id_uk`.
CREATE TABLE planning.budget (
  id                    uuid        PRIMARY KEY,
  workspace_id          uuid        NOT NULL REFERENCES iam.workspace (id),
  period_id             uuid        NOT NULL,
  currency              text        NOT NULL REFERENCES fx.currency (code),
  origin                text        NOT NULL DEFAULT 'EMPTY' CHECK (origin IN ('EMPTY', 'TEMPLATE', 'CLONE')),
  -- La FK a la versión de template la agrega add-budget-templates.
  template_version_id   uuid        NULL,
  cloned_from_budget_id uuid        NULL,
  zero_based            boolean     NOT NULL DEFAULT false,
  version               integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid        NULL,
  CONSTRAINT budget_period_uk UNIQUE (workspace_id, period_id),
  CONSTRAINT budget_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT budget_period_fk FOREIGN KEY (workspace_id, period_id)
    REFERENCES planning.financial_period (workspace_id, id),
  CONSTRAINT budget_cloned_from_fk FOREIGN KEY (workspace_id, cloned_from_budget_id)
    REFERENCES planning.budget (workspace_id, id)
);
COMMENT ON TABLE planning.budget IS
  'Plan mensual de un periodo financiero en la moneda base (planning/budgets): un plan por periodo; sin gastado (INV-034).';

CREATE TABLE planning.budget_line (
  id                 uuid           PRIMARY KEY,
  workspace_id       uuid           NOT NULL REFERENCES iam.workspace (id),
  budget_id          uuid           NOT NULL,
  target_kind        text           NOT NULL CHECK (target_kind IN ('CATEGORY', 'GROUP', 'TAG')),
  -- Referencia lógica a classification.* (sin FK entre schemas, NFR-DATA-015).
  target_id          uuid           NOT NULL,
  nature             text           NOT NULL CHECK (nature IN ('EXPENSE', 'INCOME')),
  kind               text           NOT NULL CHECK (kind IN ('FIXED', 'MAXIMUM', 'MINIMUM', 'RANGE', 'PERCENT_OF_INCOME')),
  planned_amount     numeric(38,18) NULL CHECK (planned_amount IS NULL OR planned_amount >= 0),
  min_amount         numeric(38,18) NULL CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount         numeric(38,18) NULL CHECK (max_amount IS NULL OR max_amount >= 0),
  percent            numeric(9,4)   NULL CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  income_basis       text           NULL CHECK (income_basis IS NULL OR income_basis IN ('EXPECTED', 'ACTUAL')),
  rollover_policy    text           NOT NULL DEFAULT 'NONE' CHECK (rollover_policy IN ('NONE', 'CARRY_POSITIVE', 'CARRY_ALL')),
  rollover_cap       numeric(38,18) NULL CHECK (rollover_cap IS NULL OR rollover_cap >= 0),
  rollover_in_amount numeric(38,18) NULL,
  rollover_status    text           NOT NULL DEFAULT 'NONE' CHECK (rollover_status IN ('NONE', 'PROVISIONAL', 'FINAL')),
  thresholds         numeric(7,2)[] NOT NULL DEFAULT '{}',
  source             text           NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'TEMPLATE', 'CLONE')),
  -- La FK a la línea de template la agrega add-budget-templates.
  template_line_id   uuid           NULL,
  overridden         boolean        NOT NULL DEFAULT false,
  version            integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT budget_line_target_uk UNIQUE (budget_id, target_kind, target_id),
  CONSTRAINT budget_line_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT budget_line_budget_fk FOREIGN KEY (workspace_id, budget_id) REFERENCES planning.budget (workspace_id, id),
  CONSTRAINT budget_line_range_ck CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount),
  CONSTRAINT budget_line_thresholds_ck CHECK (cardinality(thresholds) <= 10),
  CONSTRAINT budget_line_kind_shape_ck CHECK (
       (kind IN ('FIXED', 'MAXIMUM') AND planned_amount IS NOT NULL AND min_amount IS NULL AND max_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'MINIMUM' AND min_amount IS NOT NULL AND planned_amount IS NULL AND max_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'RANGE' AND min_amount IS NOT NULL AND max_amount IS NOT NULL AND planned_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'PERCENT_OF_INCOME' AND percent IS NOT NULL AND income_basis IS NOT NULL AND planned_amount IS NULL
          AND min_amount IS NULL AND max_amount IS NULL)
  ),
  -- Ingresos: solo monto fijo, sin umbrales ni rollover. Los tags son siempre de gasto. MINIMUM: sin umbrales.
  CONSTRAINT budget_line_nature_ck CHECK (
    (nature = 'EXPENSE' OR (kind = 'FIXED' AND cardinality(thresholds) = 0 AND rollover_policy = 'NONE'))
    AND (target_kind <> 'TAG' OR nature = 'EXPENSE')
    AND (kind <> 'MINIMUM' OR (cardinality(thresholds) = 0 AND rollover_policy = 'NONE'))
  ),
  -- El rollover lo gobierna la política de la línea del periodo ANTERIOR (design decisión 10): el remanente recibido
  -- puede existir en una línea cuya propia política sea NONE. El tope solo con política.
  CONSTRAINT budget_line_rollover_ck CHECK (
    (rollover_policy = 'NONE' AND rollover_cap IS NULL)
    OR (rollover_policy <> 'NONE' AND kind IN ('FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'))
  )
);
CREATE INDEX budget_line_target_ix ON planning.budget_line (workspace_id, target_kind, target_id);
COMMENT ON TABLE planning.budget_line IS
  'Líneas del plan (planning/budgets): objetivo + tipo + montos + umbrales + rollover; nunca el gastado (INV-034).';

CREATE TABLE planning.budget_threshold_crossing (
  workspace_id     uuid           NOT NULL REFERENCES iam.workspace (id),
  period_id        uuid           NOT NULL,
  target_kind      text           NOT NULL CHECK (target_kind IN ('CATEGORY', 'GROUP', 'TAG')),
  target_id        uuid           NOT NULL,
  threshold        numeric(7,2)   NOT NULL CHECK (threshold > 0 AND threshold <= 1000),
  budget_id        uuid           NOT NULL,
  -- La línea puede borrarse y reagregarse: el cruce sobrevive (dedupe por objetivo), sin FK.
  budget_line_id   uuid           NOT NULL,
  reference_amount numeric(38,18) NOT NULL,
  actual_amount    numeric(38,18) NOT NULL,
  currency         text           NOT NULL REFERENCES fx.currency (code),
  crossed_at       timestamptz    NOT NULL DEFAULT now(),
  event_id         uuid           NOT NULL,
  PRIMARY KEY (workspace_id, period_id, target_kind, target_id, threshold),
  CONSTRAINT budget_crossing_period_fk FOREIGN KEY (workspace_id, period_id)
    REFERENCES planning.financial_period (workspace_id, id),
  CONSTRAINT budget_crossing_budget_fk FOREIGN KEY (workspace_id, budget_id)
    REFERENCES planning.budget (workspace_id, id)
);
COMMENT ON TABLE planning.budget_threshold_crossing IS
  'Cruces de umbral (append-only): una fila por periodo, objetivo y umbral; el hecho de umbral se emite una sola vez.';

-- Inmutabilidad de los cruces (docs/31 D19): defensa adicional a los grants.
CREATE TRIGGER budget_threshold_crossing_immutable_trg BEFORE UPDATE OR DELETE ON planning.budget_threshold_crossing
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER budget_threshold_crossing_no_truncate_trg BEFORE TRUNCATE ON planning.budget_threshold_crossing
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE planning.budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_line FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_threshold_crossing ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_threshold_crossing FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON planning.budget TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.budget_line TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.budget_threshold_crossing TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON planning.budget, planning.budget_line, planning.budget_threshold_crossing FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON planning.budget TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON planning.budget_line TO pf_app;
GRANT SELECT, INSERT ON planning.budget_threshold_crossing TO pf_app;

-- Purga del workspace demo (ADR-0026): cruces y líneas antes que el plan; el plan antes que el periodo (160).
SELECT platform.register_workspace_scoped_table('planning.budget_threshold_crossing'::regclass, 130, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.budget_line'::regclass, 140, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.budget'::regclass, 150, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'planning'
   AND table_name IN ('budget_threshold_crossing', 'budget_line', 'budget');
DROP TABLE planning.budget_threshold_crossing;
DROP TABLE planning.budget_line;
DROP TABLE planning.budget;
