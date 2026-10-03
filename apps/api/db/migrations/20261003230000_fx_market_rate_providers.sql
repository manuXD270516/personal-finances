-- Providers de tasas de mercado (openspec add-market-rate-providers, tarea 4.1; design.md § Modelo de datos y
-- decisiones 3, 4 y 8; ADR-0025). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * fx.exchange_rate        columnas nuevas INMUTABLES (sin UPDATE para nadie, INV-011): provider, fetched_at,
--                             raw_payload (texto exacto de la respuesta), anomaly_*; coherencia origen ⇔ provider;
--                             índice único de idempotencia por (workspace, provider, par, tipo, vigencia). El worker
--                             (`pf_worker`, miembro de `pf_app`) inserta con `SET LOCAL app.workspace_id` (ADR-0023).
--   * fx.rate_anomaly_review  WS, APPEND-ONLY: decisión (CONFIRMED/REJECTED) de un EDITOR/OWNER sobre una tasa
--                             marcada como anómala; una sola por tasa (PK).
--   * fx.provider_run         tabla de INSTALACIÓN sin `workspace_id` ni datos de usuario: bitácora de intentos por
--                             provider (resultado, código de error, latencia, muestras nuevas, Retry-After). RLS
--                             FORZADA con políticas explícitas por rol (lectura pf_app; escritura/purga pf_worker).
-- El índice único no usa CONCURRENTLY: dbmate corre cada migración en una transacción y la tabla es pequeña.

-- migrate:up

-- ---------------------------------------------------------------- fx.exchange_rate (columnas de provider)
ALTER TABLE fx.exchange_rate
  ADD COLUMN fetched_at               timestamptz   NULL,
  ADD COLUMN raw_payload              text          NULL CHECK (raw_payload IS NULL OR length(raw_payload) <= 1048576),
  ADD COLUMN anomaly_flagged          boolean       NOT NULL DEFAULT false,
  ADD COLUMN anomaly_baseline_rate_id uuid          NULL,
  ADD COLUMN anomaly_variation_pct    numeric(12,4) NULL;

ALTER TABLE fx.exchange_rate
  ADD CONSTRAINT exchange_rate_provider_ck CHECK (provider IS NULL OR provider IN ('PARALELO_BO', 'DOLARAPI_BO')),
  -- Origen proveedor ⇔ provider informado (las tasas manuales nunca llevan provider).
  ADD CONSTRAINT exchange_rate_source_provider_ck CHECK ((source = 'PROVIDER') = (provider IS NOT NULL)),
  ADD CONSTRAINT exchange_rate_provider_fetched_ck CHECK ((provider IS NULL) = (fetched_at IS NULL)),
  -- Marca de anomalía completa o ausente.
  ADD CONSTRAINT exchange_rate_anomaly_ck CHECK (
    (anomaly_flagged AND anomaly_baseline_rate_id IS NOT NULL AND anomaly_variation_pct IS NOT NULL AND provider IS NOT NULL)
    OR (NOT anomaly_flagged AND anomaly_baseline_rate_id IS NULL AND anomaly_variation_pct IS NULL)
  ),
  -- La línea base es una tasa del MISMO workspace.
  ADD CONSTRAINT exchange_rate_anomaly_baseline_fk FOREIGN KEY (workspace_id, anomaly_baseline_rate_id)
    REFERENCES fx.exchange_rate (workspace_id, id);

-- design.md decisión 3: una muestra con el mismo provider, par, tipo y vigencia no se registra dos veces.
CREATE UNIQUE INDEX exchange_rate_provider_uk ON fx.exchange_rate
  (workspace_id, provider, base_currency, quote_currency, rate_type, as_of) WHERE provider IS NOT NULL;
-- Relleno de días faltantes por feed.
CREATE INDEX exchange_rate_provider_day_idx ON fx.exchange_rate
  (workspace_id, provider, base_currency, quote_currency, rate_type, as_of_date) WHERE provider IS NOT NULL;

COMMENT ON COLUMN fx.exchange_rate.raw_payload IS
  'Respuesta cruda EXACTA del provider (texto, no jsonb: auditable byte a byte). Nunca se expone en la API.';
COMMENT ON COLUMN fx.exchange_rate.anomaly_flagged IS
  'Variación > FX_ANOMALY_THRESHOLD_PCT vs la tasa aceptada anterior: no se usa hasta confirmarse (fx.rate_anomaly_review).';

-- ---------------------------------------------------------------- fx.rate_anomaly_review
CREATE TABLE fx.rate_anomaly_review (
  exchange_rate_id uuid        PRIMARY KEY,
  workspace_id     uuid        NOT NULL REFERENCES iam.workspace (id),
  decision         text        NOT NULL CHECK (decision IN ('CONFIRMED', 'REJECTED')),
  reason           text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  decided_by       uuid        NOT NULL,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_anomaly_review_rate_fk FOREIGN KEY (workspace_id, exchange_rate_id)
    REFERENCES fx.exchange_rate (workspace_id, id)
);
COMMENT ON TABLE fx.rate_anomaly_review IS
  'Decisión (append-only) de un EDITOR/OWNER sobre una tasa de provider marcada como anómala (fx/market-rate-providers).';

-- Solo tasas marcadas pueden revisarse (segunda barrera de FX_RATE_NOT_ANOMALOUS).
CREATE FUNCTION fx.assert_anomaly_review_target() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fx.exchange_rate r WHERE r.id = NEW.exchange_rate_id AND r.anomaly_flagged) THEN
    RAISE EXCEPTION 'fx rate % is not flagged as anomalous', NEW.exchange_rate_id
      USING ERRCODE = '23514', CONSTRAINT = 'rate_anomaly_review_target_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rate_anomaly_review_target BEFORE INSERT ON fx.rate_anomaly_review
  FOR EACH ROW EXECUTE FUNCTION fx.assert_anomaly_review_target();
REVOKE ALL ON FUNCTION fx.assert_anomaly_review_target() FROM PUBLIC;

-- ---------------------------------------------------------------- fx.provider_run (instalación)
CREATE TABLE fx.provider_run (
  id                uuid        PRIMARY KEY,
  provider          text        NOT NULL CHECK (provider IN ('PARALELO_BO', 'DOLARAPI_BO')),
  kind              text        NOT NULL CHECK (kind IN ('POLL', 'BACKFILL', 'GAP_FILL')),
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL,
  outcome           text        NOT NULL
                    CHECK (outcome IN ('OK', 'NO_NEW_SAMPLE', 'FAILED', 'SKIPPED_RATE_LIMIT', 'SKIPPED_CACHE')),
  error_code        text        NULL CHECK (error_code IS NULL OR error_code IN (
                      'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED',
                      'PROVIDER_PAYLOAD_INVALID', 'PROVIDER_SCHEMA_CHANGED', 'FX_PROVIDER_CONFIG_INVALID')),
  http_status       integer     NULL CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  latency_ms        integer     NOT NULL CHECK (latency_ms >= 0),
  new_samples       integer     NOT NULL DEFAULT 0 CHECK (new_samples >= 0),
  retry_after_until timestamptz NULL,
  history_points    integer     NULL CHECK (history_points IS NULL OR history_points >= 0),
  history_from      date        NULL,
  history_to        date        NULL,
  CONSTRAINT provider_run_error_ck CHECK ((outcome = 'FAILED') = (error_code IS NOT NULL)),
  CONSTRAINT provider_run_finished_ck CHECK (finished_at >= started_at)
);
CREATE INDEX provider_run_provider_started_idx ON fx.provider_run (provider, started_at DESC);
CREATE INDEX provider_run_started_idx ON fx.provider_run (started_at);
COMMENT ON TABLE fx.provider_run IS
  'Bitácora de intentos de los providers de tasas (instalación, sin workspace_id ni datos de usuario; purga > 90 días).';

-- ---------------------------------------------------------------- RLS y grants
ALTER TABLE fx.rate_anomaly_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_anomaly_review FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON fx.rate_anomaly_review TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

ALTER TABLE fx.provider_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.provider_run FORCE ROW LEVEL SECURITY;
-- Sin datos de negocio ni de usuario: lectura para la API (estado) y escritura/purga solo del worker.
CREATE POLICY provider_run_read ON fx.provider_run FOR SELECT TO pf_app USING (true);
CREATE POLICY provider_run_write ON fx.provider_run FOR INSERT TO pf_worker WITH CHECK (true);
CREATE POLICY provider_run_purge ON fx.provider_run FOR DELETE TO pf_worker USING (true);

REVOKE ALL ON fx.rate_anomaly_review, fx.provider_run FROM PUBLIC;
REVOKE ALL ON fx.rate_anomaly_review, fx.provider_run FROM pf_app, pf_worker;
GRANT SELECT, INSERT ON fx.rate_anomaly_review TO pf_app;
GRANT SELECT ON fx.provider_run TO pf_app;
GRANT INSERT, DELETE ON fx.provider_run TO pf_worker;

-- migrate:down
DROP TABLE fx.provider_run;
DROP TRIGGER rate_anomaly_review_target ON fx.rate_anomaly_review;
DROP FUNCTION fx.assert_anomaly_review_target();
DROP TABLE fx.rate_anomaly_review;
DROP INDEX fx.exchange_rate_provider_day_idx;
DROP INDEX fx.exchange_rate_provider_uk;
ALTER TABLE fx.exchange_rate
  DROP CONSTRAINT exchange_rate_anomaly_baseline_fk,
  DROP CONSTRAINT exchange_rate_anomaly_ck,
  DROP CONSTRAINT exchange_rate_provider_fetched_ck,
  DROP CONSTRAINT exchange_rate_source_provider_ck,
  DROP CONSTRAINT exchange_rate_provider_ck,
  DROP COLUMN anomaly_variation_pct,
  DROP COLUMN anomaly_baseline_rate_id,
  DROP COLUMN anomaly_flagged,
  DROP COLUMN raw_payload,
  DROP COLUMN fetched_at;
