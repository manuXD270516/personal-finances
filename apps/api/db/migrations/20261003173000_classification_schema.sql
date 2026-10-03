-- Catálogos de CLASSIFICATION (openspec add-classification, design §10; docs/08 §5.5). Expand, no destructiva. Se
-- ejecuta con `pf_migrator` (dueño; ni pf_app ni pf_worker son owners).
--
-- Crea el schema `classification` con:
--   * `category_group`, `category`, `tag`, `counterparty`, `counterparty_alias` (WS): RLS habilitada y FORZADA por
--     workspace (fail-closed con PF002). Grants SELECT/INSERT/UPDATE sin DELETE (INV-019, docs/08 §6: nunca hard
--     delete; solo archivado). `counterparty_alias` admite DELETE (tabla de enlace: quitar un alias no borra historia).
--   * Unicidad de nombres SOLO entre activos (índices parciales sobre `normalized_name`: minúsculas, sin acentos,
--     espacios colapsados). Categorías: por (workspace, grupo, padre). Alias: únicos por workspace entre activos.
--   * Triggers de defensa: tipo = tipo del grupo y del padre, profundidad ≤ 2 (grupo → categoría → subcategoría) y
--     categorías de sistema no archivables, no renombrables, sin padre ni subcategorías.
--   * `category_name_i18n` (WS+G): nombres visibles de las 11 categorías de sistema por locale (datos de referencia
--     globales; solo lectura para pf_app).

-- migrate:up
CREATE SCHEMA classification;
GRANT USAGE ON SCHEMA classification TO pf_app;

CREATE TABLE classification.category_group (
  id              uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES iam.workspace (id),
  kind            text        NOT NULL CHECK (kind IN ('EXPENSE', 'INCOME')),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  normalized_name text        NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 80),
  sort_order      integer     NOT NULL DEFAULT 0,
  archived_at     timestamptz NULL,
  archived_by     uuid        NULL,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX category_group_active_name_uq
  ON classification.category_group (workspace_id, kind, normalized_name) WHERE archived_at IS NULL;

CREATE TABLE classification.category (
  id              uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL,
  group_id        uuid        NOT NULL,
  parent_id       uuid        NULL,
  kind            text        NOT NULL CHECK (kind IN ('EXPENSE', 'INCOME')),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  normalized_name text        NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 80),
  system_code     text        NULL CHECK (system_code IN ('FEES', 'FX_FEES', 'INTEREST', 'LOAN_FEES', 'INSURANCE',
                                'TAXES', 'ADJUSTMENTS', 'UNCATEGORIZED', 'INTEREST_EARNED', 'ADJUSTMENTS_INCOME',
                                'UNCATEGORIZED_INCOME')),
  icon            text        NULL CHECK (icon IS NULL OR length(icon) <= 50),
  color           text        NULL CHECK (color IS NULL OR length(color) <= 20),
  sort_order      integer     NOT NULL DEFAULT 0,
  archived_at     timestamptz NULL,
  archived_by     uuid        NULL,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (group_id, workspace_id) REFERENCES classification.category_group (id, workspace_id),
  FOREIGN KEY (parent_id, workspace_id) REFERENCES classification.category (id, workspace_id),
  CONSTRAINT category_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT category_system_no_parent CHECK (system_code IS NULL OR parent_id IS NULL),
  CONSTRAINT category_system_active CHECK (system_code IS NULL OR archived_at IS NULL)
);
CREATE UNIQUE INDEX category_system_code_uq ON classification.category (workspace_id, system_code)
  WHERE system_code IS NOT NULL;
CREATE UNIQUE INDEX category_active_name_uq ON classification.category
  (workspace_id, group_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name)
  WHERE archived_at IS NULL;
CREATE INDEX category_parent_idx ON classification.category (workspace_id, parent_id);

-- Defensa en BD de las reglas del dominio (design §2, §6). SQLSTATE 23514 (check_violation) con el código del dominio.
CREATE FUNCTION classification.category_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_group_kind  text;
  v_parent      record;
BEGIN
  SELECT kind INTO v_group_kind FROM classification.category_group
   WHERE id = NEW.group_id AND workspace_id = NEW.workspace_id;
  IF v_group_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'CATEGORY_KIND_MISMATCH: category kind % differs from its group', NEW.kind
      USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT kind, parent_id, group_id, system_code INTO v_parent FROM classification.category
     WHERE id = NEW.parent_id AND workspace_id = NEW.workspace_id;
    IF v_parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'CATEGORY_DEPTH_EXCEEDED: a subcategory cannot have subcategories' USING ERRCODE = '23514';
    END IF;
    IF v_parent.system_code IS NOT NULL THEN
      RAISE EXCEPTION 'SYSTEM_CATEGORY_IMMUTABLE: system categories cannot have subcategories'
        USING ERRCODE = '23514';
    END IF;
    IF v_parent.kind IS DISTINCT FROM NEW.kind OR v_parent.group_id IS DISTINCT FROM NEW.group_id THEN
      RAISE EXCEPTION 'CATEGORY_KIND_MISMATCH: a subcategory shares kind and group with its parent'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM classification.category
                WHERE parent_id = NEW.id AND workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'CATEGORY_DEPTH_EXCEEDED: a category with subcategories cannot be a subcategory'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'CATEGORY_KIND_MISMATCH: the category kind is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.system_code IS NOT NULL AND (NEW.system_code IS DISTINCT FROM OLD.system_code
        OR NEW.name IS DISTINCT FROM OLD.name OR NEW.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'SYSTEM_CATEGORY_IMMUTABLE: system categories cannot be renamed or archived'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION classification.category_guard() FROM PUBLIC;
CREATE TRIGGER category_guard BEFORE INSERT OR UPDATE ON classification.category
  FOR EACH ROW EXECUTE FUNCTION classification.category_guard();

CREATE TABLE classification.tag (
  id              uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES iam.workspace (id),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  normalized_name text        NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 50),
  color           text        NULL CHECK (color IS NULL OR length(color) <= 20),
  archived_at     timestamptz NULL,
  archived_by     uuid        NULL,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tag_active_name_uq ON classification.tag (workspace_id, normalized_name)
  WHERE archived_at IS NULL;

CREATE TABLE classification.counterparty (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  normalized_name     text        NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 120),
  kind                text        NOT NULL DEFAULT 'OTHER' CHECK (kind IN ('MERCHANT', 'PERSON', 'EMPLOYER',
                                    'SERVICE_PROVIDER', 'FINANCIAL_INSTITUTION', 'LENDER', 'EXCHANGE', 'P2P_TRADER',
                                    'GOVERNMENT', 'OTHER')),
  icon                text        NULL CHECK (icon IS NULL OR length(icon) <= 50),
  default_category_id uuid        NULL,
  notes               text        NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  website             text        NULL CHECK (website IS NULL OR length(website) <= 2048),
  archived_at         timestamptz NULL,
  archived_by         uuid        NULL,
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (default_category_id, workspace_id) REFERENCES classification.category (id, workspace_id)
);
CREATE UNIQUE INDEX counterparty_active_name_uq ON classification.counterparty (workspace_id, normalized_name)
  WHERE archived_at IS NULL;

CREATE TABLE classification.counterparty_alias (
  workspace_id     uuid    NOT NULL,
  counterparty_id  uuid    NOT NULL,
  alias            text    NOT NULL CHECK (length(alias) BETWEEN 1 AND 120),
  alias_normalized text    NOT NULL CHECK (length(alias_normalized) >= 3),
  -- Copia del estado de la counterparty: la unicidad del alias solo aplica entre counterparties activas.
  active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, counterparty_id, alias_normalized),
  FOREIGN KEY (counterparty_id, workspace_id) REFERENCES classification.counterparty (id, workspace_id)
);
CREATE UNIQUE INDEX counterparty_alias_active_uq ON classification.counterparty_alias (workspace_id, alias_normalized)
  WHERE active;

-- RLS por workspace (ADR-0023): habilitada, FORZADA y fail-closed (PF002 sin contexto).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['category_group', 'category', 'tag', 'counterparty', 'counterparty_alias'] LOOP
    EXECUTE format('ALTER TABLE classification.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE classification.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON classification.%I FROM PUBLIC, pf_app', t);
    EXECUTE format(
      'CREATE POLICY ws_isolation ON classification.%I TO pf_app '
      'USING (workspace_id = platform.current_workspace_id()) '
      'WITH CHECK (workspace_id = platform.current_workspace_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON classification.%I TO pf_app', t);
  END LOOP;
END
$$;
GRANT DELETE ON classification.counterparty_alias TO pf_app;

-- Nombres visibles de las categorías de sistema por locale (WS+G: datos de referencia globales, solo lectura).
CREATE TABLE classification.category_name_i18n (
  system_code text NOT NULL,
  locale      text NOT NULL CHECK (locale IN ('es', 'en', 'pt')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  PRIMARY KEY (system_code, locale)
);

INSERT INTO classification.category_name_i18n (system_code, locale, name) VALUES
  ('FEES', 'es', 'Comisiones'), ('FEES', 'en', 'Fees'), ('FEES', 'pt', 'Tarifas'),
  ('FX_FEES', 'es', 'Comisiones de cambio'), ('FX_FEES', 'en', 'FX fees'), ('FX_FEES', 'pt', 'Tarifas de câmbio'),
  ('INTEREST', 'es', 'Intereses pagados'), ('INTEREST', 'en', 'Interest paid'), ('INTEREST', 'pt', 'Juros pagos'),
  ('LOAN_FEES', 'es', 'Comisiones de préstamo'), ('LOAN_FEES', 'en', 'Loan fees'),
  ('LOAN_FEES', 'pt', 'Tarifas de empréstimo'),
  ('INSURANCE', 'es', 'Seguros'), ('INSURANCE', 'en', 'Insurance'), ('INSURANCE', 'pt', 'Seguros'),
  ('TAXES', 'es', 'Impuestos'), ('TAXES', 'en', 'Taxes'), ('TAXES', 'pt', 'Impostos'),
  ('ADJUSTMENTS', 'es', 'Ajustes'), ('ADJUSTMENTS', 'en', 'Adjustments'), ('ADJUSTMENTS', 'pt', 'Ajustes'),
  ('UNCATEGORIZED', 'es', 'Sin categoría'), ('UNCATEGORIZED', 'en', 'Uncategorized'),
  ('UNCATEGORIZED', 'pt', 'Sem categoria'),
  ('INTEREST_EARNED', 'es', 'Intereses ganados'), ('INTEREST_EARNED', 'en', 'Interest earned'),
  ('INTEREST_EARNED', 'pt', 'Juros recebidos'),
  ('ADJUSTMENTS_INCOME', 'es', 'Ajustes'), ('ADJUSTMENTS_INCOME', 'en', 'Adjustments'),
  ('ADJUSTMENTS_INCOME', 'pt', 'Ajustes'),
  ('UNCATEGORIZED_INCOME', 'es', 'Sin categoría'), ('UNCATEGORIZED_INCOME', 'en', 'Uncategorized'),
  ('UNCATEGORIZED_INCOME', 'pt', 'Sem categoria');

-- RLS después de cargar los datos de referencia (FORCE también aplica al owner).
ALTER TABLE classification.category_name_i18n ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification.category_name_i18n FORCE ROW LEVEL SECURITY;
REVOKE ALL ON classification.category_name_i18n FROM PUBLIC, pf_app;
CREATE POLICY global_read ON classification.category_name_i18n FOR SELECT TO pf_app USING (true);
GRANT SELECT ON classification.category_name_i18n TO pf_app;

-- migrate:down
DROP SCHEMA classification CASCADE;
