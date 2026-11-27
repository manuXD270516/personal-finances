-- CLASSIFICATION: fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge, tarea 4.1; design.md
-- decisión 5 y § Base de datos; D480, D494). Expand, no destructiva, sin datos: dos columnas nullable en cada tabla.
-- `merged_into_id` apunta a la destino (FK compuesta con el workspace, sin ciclos de borrado: nunca se borra) y
-- `merged_at` es el instante de la fusión; las dos se fijan juntas. Una fusionada queda archivada de forma permanente
-- (la aplicación rechaza desarchivarla con CATEGORY_MERGED / COUNTERPARTY_MERGED). Las tablas ya tienen RLS forzada y
-- registro en `platform.workspace_scoped_table`. Se ejecuta con `pf_migrator`.

-- migrate:up
ALTER TABLE classification.category
  ADD COLUMN merged_into_id uuid NULL,
  ADD COLUMN merged_at timestamptz NULL,
  ADD CONSTRAINT category_merged_into_fk FOREIGN KEY (merged_into_id, workspace_id)
    REFERENCES classification.category (id, workspace_id),
  ADD CONSTRAINT category_merged_not_self_ck CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  ADD CONSTRAINT category_merged_pair_ck CHECK ((merged_into_id IS NULL) = (merged_at IS NULL)),
  ADD CONSTRAINT category_merged_archived_ck CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL);
COMMENT ON COLUMN classification.category.merged_into_id IS
  'Categoría destino en la que se fusionó esta (NULL si no se fusionó). Archivada de forma permanente.';
COMMENT ON COLUMN classification.category.merged_at IS 'Instante de la fusión; NULL si merged_into_id es NULL.';

ALTER TABLE classification.counterparty
  ADD COLUMN merged_into_id uuid NULL,
  ADD COLUMN merged_at timestamptz NULL,
  ADD CONSTRAINT counterparty_merged_into_fk FOREIGN KEY (merged_into_id, workspace_id)
    REFERENCES classification.counterparty (id, workspace_id),
  ADD CONSTRAINT counterparty_merged_not_self_ck CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  ADD CONSTRAINT counterparty_merged_pair_ck CHECK ((merged_into_id IS NULL) = (merged_at IS NULL)),
  ADD CONSTRAINT counterparty_merged_archived_ck CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL);
COMMENT ON COLUMN classification.counterparty.merged_into_id IS
  'Contraparte destino en la que se fusionó esta (NULL si no se fusionó). Archivada de forma permanente.';
COMMENT ON COLUMN classification.counterparty.merged_at IS 'Instante de la fusión; NULL si merged_into_id es NULL.';

CREATE INDEX category_merged_into_idx ON classification.category (workspace_id, merged_into_id)
  WHERE merged_into_id IS NOT NULL;
CREATE INDEX counterparty_merged_into_idx ON classification.counterparty (workspace_id, merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- migrate:down
DROP INDEX classification.counterparty_merged_into_idx;
DROP INDEX classification.category_merged_into_idx;
ALTER TABLE classification.counterparty
  DROP CONSTRAINT counterparty_merged_archived_ck,
  DROP CONSTRAINT counterparty_merged_pair_ck,
  DROP CONSTRAINT counterparty_merged_not_self_ck,
  DROP CONSTRAINT counterparty_merged_into_fk,
  DROP COLUMN merged_at,
  DROP COLUMN merged_into_id;
ALTER TABLE classification.category
  DROP CONSTRAINT category_merged_archived_ck,
  DROP CONSTRAINT category_merged_pair_ck,
  DROP CONSTRAINT category_merged_not_self_ck,
  DROP CONSTRAINT category_merged_into_fk,
  DROP COLUMN merged_at,
  DROP COLUMN merged_into_id;
