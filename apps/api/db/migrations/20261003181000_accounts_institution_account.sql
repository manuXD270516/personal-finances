-- Cuentas e instituciones (openspec add-accounts-management, tareas 2.3 y 5.1; docs/08 §5.2 con los ajustes de
-- design.md decisión 10; docs/31 D3–D5; ADR-0007, ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * institution  WS: SELECT/INSERT/UPDATE (sin DELETE, NFR-DATA-012); único parcial por nombre entre activas.
--   * account      WS: SELECT/INSERT/UPDATE (sin DELETE); tipo/naturaleza/liquidez con CHECK; único parcial por nombre
--                  entre no archivadas; FK compuesta (workspace, institución); SIN ledger_account_id (decisión 3: el
--                  vínculo 1:1 lo garantiza ledger.ledger_account (workspace_id, source_account_id)).
--   * account_tag  WS: tabla de enlace (SELECT/INSERT/DELETE); `tag_id` lógico (classification.tag).
-- Sin datos: el catálogo inicial de instituciones es un seed por workspace (design.md decisión 8).

-- migrate:up
CREATE SCHEMA accounts;
GRANT USAGE ON SCHEMA accounts TO pf_app;

-- ---------------------------------------------------------------- accounts.institution
CREATE TABLE accounts.institution (
  id           uuid        PRIMARY KEY,
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind         text        NOT NULL CHECK (kind IN ('BANK', 'FINTECH', 'EXCHANGE', 'BROKER', 'WALLET_PROVIDER', 'OTHER')),
  country_code text        NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  website      text        NULL CHECK (website IS NULL OR length(website) <= 500),
  icon         text        NULL CHECK (icon IS NULL OR length(icon) <= 40),
  color        text        NULL CHECK (color IS NULL OR length(color) <= 20),
  notes        text        NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  archived_at  timestamptz NULL,
  version      integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_ws_id_uk UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX institution_name_uk ON accounts.institution (workspace_id, lower(name))
  WHERE archived_at IS NULL;
COMMENT ON TABLE accounts.institution IS
  'Instituciones financieras del workspace (accounts/institutions). Nunca filas globales ni datos en migraciones.';

-- ---------------------------------------------------------------- accounts.account
CREATE TABLE accounts.account (
  id                   uuid        PRIMARY KEY,
  workspace_id         uuid        NOT NULL REFERENCES iam.workspace (id),
  name                 text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  type                 text        NOT NULL CHECK (type IN ('BANK', 'CASH', 'DIGITAL_WALLET', 'CREDIT_CARD', 'LOAN',
                                     'CRYPTO_WALLET', 'INVESTMENT', 'SAVINGS', 'VIRTUAL', 'MANUAL_ASSET', 'MANUAL_LIABILITY')),
  classification       text        NOT NULL CHECK (classification IN ('ASSET', 'LIABILITY')),
  currency             varchar(16) NOT NULL REFERENCES fx.currency (code),
  institution_id       uuid        NULL,
  liquidity            text        NOT NULL CHECK (liquidity IN ('LIQUID', 'SEMI_LIQUID', 'ILLIQUID')),
  include_in_net_worth boolean     NOT NULL DEFAULT true,
  include_in_budget    boolean     NOT NULL DEFAULT true,
  opened_on            date        NULL,
  closed_on            date        NULL,
  close_reason         text        NULL CHECK (close_reason IS NULL OR length(close_reason) <= 500),
  archived_at          timestamptz NULL,
  archive_reason       text        NULL CHECK (archive_reason IS NULL OR length(archive_reason) <= 500),
  display_order        integer     NOT NULL DEFAULT 0,
  account_number_last4 text        NULL CHECK (account_number_last4 ~ '^[A-Za-z0-9]{4}$'),
  color                text        NULL CHECK (color IS NULL OR length(color) <= 20),
  icon                 text        NULL CHECK (icon IS NULL OR length(icon) <= 40),
  notes                text        NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  crypto_network       text        NULL CHECK (crypto_network IS NULL OR length(crypto_network) <= 20),
  version              integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT account_institution_fk FOREIGN KEY (workspace_id, institution_id)
    REFERENCES accounts.institution (workspace_id, id),
  CONSTRAINT account_classification_ck CHECK (
    classification = CASE WHEN type IN ('CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY') THEN 'LIABILITY' ELSE 'ASSET' END),
  CONSTRAINT account_closed_after_opened_ck CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on)
);
CREATE UNIQUE INDEX account_name_uk ON accounts.account (workspace_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX account_ws_order_idx ON accounts.account (workspace_id, display_order, id);
CREATE INDEX account_institution_idx ON accounts.account (workspace_id, institution_id) WHERE institution_id IS NOT NULL;
COMMENT ON TABLE accounts.account IS
  'Cuentas del usuario (accounts/account-management). El saldo NO se guarda: es Σ postings del ledger (INV-022).';
COMMENT ON COLUMN accounts.account.account_number_last4 IS
  'Solo los últimos 4 caracteres; el identificador completo nunca llega al backend (FR-ACCOUNTS-010).';

-- ---------------------------------------------------------------- accounts.account_tag
CREATE TABLE accounts.account_tag (
  workspace_id uuid NOT NULL,
  account_id   uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (workspace_id, account_id, tag_id),
  CONSTRAINT account_tag_account_fk FOREIGN KEY (workspace_id, account_id)
    REFERENCES accounts.account (workspace_id, id)
);

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE accounts.institution ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts.institution FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts.account FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts.account_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts.account_tag FORCE ROW LEVEL SECURITY;

-- pf_worker es miembro de pf_app (hereda sus políticas y grants).
CREATE POLICY ws_isolation ON accounts.institution TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON accounts.account TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON accounts.account_tag TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA accounts FROM PUBLIC;
REVOKE ALL ON accounts.institution, accounts.account, accounts.account_tag FROM pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON accounts.institution, accounts.account TO pf_app;
GRANT SELECT, INSERT, DELETE ON accounts.account_tag TO pf_app;

-- migrate:down
DROP SCHEMA accounts CASCADE;
