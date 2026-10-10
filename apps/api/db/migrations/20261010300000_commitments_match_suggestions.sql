-- COMMITMENTS: matching sugerido entre ocurrencias y transacciones (openspec add-commitment-matching, tarea 4.1; design.md
-- § Modelo de datos y decisiones 2, 4 y 7; docs/08 §5.7; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * commitments.occurrence_match_suggestion  WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: una sugerencia expira o se
--     decide, nunca se borra). UNIQUE (occurrence_id, transaction_id) = idempotencia del consumidor (INV-028): un mismo par
--     jamás se duplica, y un par DISMISSED, CONFIRMED o EXPIRED por otro motivo jamás revive (`ON CONFLICT DO NOTHING`).
--     `transaction_id` es una referencia lógica a txn.transaction (otro schema, sin FK, NFR-DATA-015).
--   * commitments.recurring_definition: dos columnas nulas con las tolerancias del matching (anotación de la definición;
--     `NULL` = valor por omisión del tipo de monto, docs/35 D120).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): antes que las ocurrencias (170).
-- `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas. Sin backfill: las sugerencias las crea el consumidor.

-- migrate:up
ALTER TABLE commitments.recurring_definition
  ADD COLUMN matching_amount_tolerance_pct numeric(5,2) NULL,
  ADD COLUMN matching_date_window_days     smallint     NULL,
  ADD CONSTRAINT recurring_definition_matching_pct_ck
    CHECK (matching_amount_tolerance_pct IS NULL OR matching_amount_tolerance_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT recurring_definition_matching_window_ck
    CHECK (matching_date_window_days IS NULL OR matching_date_window_days BETWEEN 0 AND 15);

CREATE TABLE commitments.occurrence_match_suggestion (
  id                 uuid           PRIMARY KEY,
  workspace_id       uuid           NOT NULL REFERENCES iam.workspace (id),
  occurrence_id      uuid           NOT NULL,
  definition_id      uuid           NOT NULL,
  -- Referencia lógica a txn.transaction (otro schema, sin FK).
  transaction_id     uuid           NOT NULL,
  score              numeric(5,2)   NOT NULL,
  confidence         text           NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  -- Diferencia absoluta de monto contra lo esperado; NULL en una ocurrencia VARIABLE.
  amount_delta       numeric(38,18) NULL CHECK (amount_delta IS NULL OR amount_delta >= 0),
  currency           varchar(16)    NOT NULL REFERENCES fx.currency (code),
  date_delta_days    smallint       NOT NULL CHECK (date_delta_days >= 0),
  counterparty_match text           NOT NULL CHECK (counterparty_match IN ('MATCH', 'UNKNOWN')),
  ambiguous          boolean        NOT NULL DEFAULT false,
  status             text           NOT NULL CHECK (status IN ('PROPOSED', 'CONFIRMED', 'DISMISSED', 'EXPIRED')),
  expire_reason      text           NULL CHECK (expire_reason IN
                       ('TRANSACTION_VOIDED', 'OCCURRENCE_RESOLVED', 'OCCURRENCE_CANCELLED', 'INCOMPATIBLE', 'SUPERSEDED')),
  source_event_id    uuid           NULL,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  decided_at         timestamptz    NULL,
  decided_by         uuid           NULL,
  version            integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT occurrence_match_suggestion_ws_id_uk UNIQUE (workspace_id, id),
  -- Idempotencia del consumidor y descarte permanente: un solo registro por par, en cualquier estado.
  CONSTRAINT occurrence_match_suggestion_pair_uk UNIQUE (occurrence_id, transaction_id),
  CONSTRAINT occurrence_match_suggestion_occurrence_fk FOREIGN KEY (workspace_id, occurrence_id)
    REFERENCES commitments.recurring_occurrence (workspace_id, id),
  CONSTRAINT occurrence_match_suggestion_definition_fk FOREIGN KEY (workspace_id, definition_id)
    REFERENCES commitments.recurring_definition (workspace_id, id),
  CONSTRAINT occurrence_match_suggestion_score_ck CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT occurrence_match_suggestion_expire_ck CHECK ((status = 'EXPIRED') = (expire_reason IS NOT NULL)),
  CONSTRAINT occurrence_match_suggestion_decided_ck CHECK (
    (status IN ('CONFIRMED', 'DISMISSED')) = (decided_at IS NOT NULL)
  )
);
-- Bandeja "Coincidencias por revisar": propuestas por puntaje (y por antigüedad para el contador y el barrido).
CREATE INDEX occurrence_match_suggestion_proposed_ix
  ON commitments.occurrence_match_suggestion (workspace_id, status, created_at) WHERE status = 'PROPOSED';
CREATE INDEX occurrence_match_suggestion_rank_ix
  ON commitments.occurrence_match_suggestion (workspace_id, score DESC, id) WHERE status = 'PROPOSED';
-- Las de una transacción (editar, anular, vincular a mano): el UNIQUE del par ya cubre las de una ocurrencia.
CREATE INDEX occurrence_match_suggestion_txn_ix
  ON commitments.occurrence_match_suggestion (workspace_id, transaction_id);
COMMENT ON TABLE commitments.occurrence_match_suggestion IS
  'Sugerencia de coincidencia entre una ocurrencia no resuelta y una transacción (commitments/recurrence-engine, FR-COMMITMENTS-010): nunca vincula sola; el EDITOR confirma o descarta.';

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE commitments.occurrence_match_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.occurrence_match_suggestion FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON commitments.occurrence_match_suggestion TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON commitments.occurrence_match_suggestion FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON commitments.occurrence_match_suggestion TO pf_app;

-- Purga del workspace demo (ADR-0026): las sugerencias referencian ocurrencias (170) y definiciones (172).
SELECT platform.register_workspace_scoped_table('commitments.occurrence_match_suggestion'::regclass, 169, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'commitments' AND table_name = 'occurrence_match_suggestion';
DROP TABLE commitments.occurrence_match_suggestion;
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_matching_window_ck,
  DROP CONSTRAINT recurring_definition_matching_pct_ck,
  DROP COLUMN matching_date_window_days,
  DROP COLUMN matching_amount_tolerance_pct;
