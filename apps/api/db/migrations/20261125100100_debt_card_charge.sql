-- DEBT: cargos de tarjeta (openspec add-card-interest-ledger-portions, design.md decisión 3; docs/08 §5.9). Expand, no
-- destructiva, sin backfill. Se ejecuta con `pf_migrator`. El schema `debt` y `debt.credit_card` ya existen.
--
--   * debt.card_charge   WS: intereses, comisiones, seguro e impuestos que cobra el banco a una cuenta de una tarjeta, con la
--     transacción (`EXPENSE` con `debt_role = CARD_CHARGE`) que los lleva al ledger. `origin` distingue el cargo registrado
--     (DEBT creó la transacción) del adoptado (un gasto existente que se marcó como cargo). Los componentes viven aquí para el
--     detalle y la auditoría; los reportes NO leen esta tabla: leen las porciones de la transacción (una sola fuente de las
--     cifras). Sin DELETE: anular marca `VOIDED` y la transacción se anula con la reversa de su asiento.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), antes que `debt.credit_card`.
-- Referencias a otros schemas (cuenta de usuario y transacción) son lógicas, sin FK (NFR-DATA-015). `pf_worker` es miembro de
-- `pf_app` y hereda sus grants y políticas (el export lo lee).

-- migrate:up
CREATE TABLE debt.card_charge (
  id               uuid           PRIMARY KEY,
  workspace_id     uuid           NOT NULL REFERENCES iam.workspace (id),
  card_id          uuid           NOT NULL,
  -- Cuenta de la tarjeta en DEBT (una por moneda) y cuenta de usuario a la que se carga.
  card_account_id  uuid           NOT NULL,
  account_id       uuid           NOT NULL,
  transaction_id   uuid           NOT NULL,
  business_date    date           NOT NULL,
  currency         varchar(16)    NOT NULL REFERENCES fx.currency (code),
  interest         numeric(38,18) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  fees             numeric(38,18) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  insurance        numeric(38,18) NOT NULL DEFAULT 0 CHECK (insurance >= 0),
  taxes            numeric(38,18) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  origin           text           NOT NULL CHECK (origin IN ('RECORDED', 'ADOPTED')),
  status           text           NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
  void_reason      text           NULL CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 200),
  created_at       timestamptz    NOT NULL DEFAULT now(),
  created_by       uuid           NOT NULL,
  voided_at        timestamptz    NULL,
  voided_by        uuid           NULL,
  version          integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT card_charge_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT card_charge_total_ck CHECK (interest + fees + insurance + taxes > 0),
  CONSTRAINT card_charge_voided_ck CHECK (
    (status = 'VOIDED') = (void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by IS NOT NULL)),
  CONSTRAINT card_charge_card_fk FOREIGN KEY (workspace_id, card_id) REFERENCES debt.credit_card (workspace_id, id),
  CONSTRAINT card_charge_card_account_fk FOREIGN KEY (workspace_id, card_account_id)
    REFERENCES debt.credit_card_account (workspace_id, id)
);
-- Una transacción es a lo sumo un cargo vigente (adoptar un gasto ya adoptado se rechaza antes de llegar aquí).
CREATE UNIQUE INDEX card_charge_transaction_uk ON debt.card_charge (workspace_id, transaction_id) WHERE status = 'ACTIVE';
CREATE INDEX card_charge_account_date_ix ON debt.card_charge (workspace_id, card_account_id, business_date);
COMMENT ON TABLE debt.card_charge IS
  'Cargo de una tarjeta (interés, comisiones, seguro, impuestos) y su transacción en el ledger (debt/credit-cards, FR-DEBT-013).';

ALTER TABLE debt.card_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_charge FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON debt.card_charge TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
GRANT SELECT, INSERT ON debt.card_charge TO pf_app;
-- Solo la anulación cambia un cargo: estado, motivo, quién y cuándo, y la versión.
GRANT UPDATE (status, void_reason, voided_at, voided_by, version) ON debt.card_charge TO pf_app;

-- Purga del workspace demo (ADR-0026): hija de `debt.credit_card_account` (193) y `debt.credit_card` (194).
SELECT platform.register_workspace_scoped_table('debt.card_charge'::regclass, 191, 'DELETE');

-- migrate:down
DROP TABLE debt.card_charge;
