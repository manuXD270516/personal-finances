-- FX: episodios de obsolescencia por par configurado (openspec add-rate-feed-alerts, tarea 4.1; design.md decisión 3
-- y § Plan de migración; docs/41 D233, D249, D250). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * fx.rate_feed_episode   WS: un episodio por (workspace, par) mientras el par lleva más de N horas sin tasa aceptada de
--                            ningún provider (`FX_FEED_STALE_ALERT_AFTER`, 6 h por defecto). Abre y cierra el job de providers
--                            (`pf_worker`); `pf_app` lee para el estado por par. El índice único parcial garantiza UN solo
--                            episodio abierto por par aunque haya dos réplicas del worker. `recovered_rate_id` es la tasa
--                            que cerró el episodio (solo con `closed_reason = RECOVERED`); quitar el par o perder su cobertura
--                            cierra el episodio sin aviso de recuperación (PAIR_REMOVED / COVERAGE_LOST).
-- NOTIFY no cambia de esquema: los tres tipos nuevos son valores de texto (`notification_type` solo exige la forma
-- `^[A-Z][A-Z0-9_]{1,59}$`) y no existe CHECK de tipos que ampliar.

-- migrate:up

CREATE TABLE fx.rate_feed_episode (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  base_currency     varchar(16) NOT NULL REFERENCES fx.currency (code),
  quote_currency    varchar(16) NOT NULL REFERENCES fx.currency (code),
  opened_at         timestamptz NOT NULL,
  -- Vigencia de la última tasa aceptada al abrirse; NULL si el par nunca tuvo una.
  last_rate_as_of   timestamptz NULL,
  closed_at         timestamptz NULL,
  recovered_rate_id uuid        NULL,
  closed_reason     text        NULL CHECK (closed_reason IN ('RECOVERED', 'PAIR_REMOVED', 'COVERAGE_LOST')),
  CONSTRAINT rate_feed_episode_distinct_ck CHECK (base_currency <> quote_currency),
  CONSTRAINT rate_feed_episode_closed_ck CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
  CONSTRAINT rate_feed_episode_recovery_ck CHECK (recovered_rate_id IS NULL OR closed_reason = 'RECOVERED'),
  CONSTRAINT rate_feed_episode_order_ck CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT rate_feed_episode_rate_fk FOREIGN KEY (workspace_id, recovered_rate_id)
    REFERENCES fx.exchange_rate (workspace_id, id)
);

-- Un solo episodio abierto por par (a prueba de dos réplicas del worker).
CREATE UNIQUE INDEX rate_feed_episode_open_uk ON fx.rate_feed_episode
  (workspace_id, base_currency, quote_currency) WHERE closed_at IS NULL;
CREATE INDEX rate_feed_episode_ws_idx ON fx.rate_feed_episode (workspace_id, opened_at DESC);

COMMENT ON TABLE fx.rate_feed_episode IS
  'Episodio de obsolescencia de un par configurado (D233): abierto mientras el par lleva más de N horas sin tasa aceptada de ningún provider; un solo episodio abierto por par.';
COMMENT ON COLUMN fx.rate_feed_episode.recovered_rate_id IS
  'Tasa aceptada que cerró el episodio (solo con closed_reason = RECOVERED).';

ALTER TABLE fx.rate_feed_episode ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_feed_episode FORCE ROW LEVEL SECURITY;
-- Lectura por workspace (la API y, por herencia de `pf_app`, el worker); abre y cierra solo el worker del job de providers.
CREATE POLICY rate_feed_episode_read ON fx.rate_feed_episode FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY rate_feed_episode_insert ON fx.rate_feed_episode FOR INSERT TO pf_worker
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY rate_feed_episode_update ON fx.rate_feed_episode FOR UPDATE TO pf_worker
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON fx.rate_feed_episode FROM PUBLIC;
REVOKE ALL ON fx.rate_feed_episode FROM pf_app, pf_worker;
GRANT SELECT ON fx.rate_feed_episode TO pf_app;
GRANT INSERT, UPDATE ON fx.rate_feed_episode TO pf_worker;

-- Purga del workspace demo (ADR-0026): antes que `fx.exchange_rate` (orden 160), que referencia con su FK.
SELECT platform.register_workspace_scoped_table('fx.rate_feed_episode'::regclass, 150, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'fx' AND table_name = 'rate_feed_episode';
DROP TABLE fx.rate_feed_episode;
