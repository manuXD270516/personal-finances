-- ACCOUNTS: vínculo de una institución con el catálogo de referencia (openspec add-exchange-house-rate-providers, tarea
-- 4.1; design.md § Plan de migración; FR-ACCOUNTS-012). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * accounts.institution  columnas nuevas NULAS `catalog_country`, `catalog_code` y `catalog_version`: país, código y
--     versión del catálogo de la que se adoptó la institución. "Los tres o ninguno" (CHECK). Un índice único parcial
--     impide dos instituciones ACTIVAS del mismo workspace vinculadas a la misma entrada (la adopción repetida devuelve la
--     existente). Las filas existentes quedan sin vínculo. RLS y `platform.workspace_scoped_table` no cambian: la tabla ya
--     está registrada y el catálogo NO es una tabla (es un archivo de datos de la instalación, sin `workspace_id`).

-- migrate:up
ALTER TABLE accounts.institution
  ADD COLUMN catalog_country char(2) NULL,
  ADD COLUMN catalog_code    text    NULL,
  ADD COLUMN catalog_version text    NULL;

ALTER TABLE accounts.institution
  ADD CONSTRAINT institution_catalog_ref_ck CHECK (
    (catalog_country IS NULL AND catalog_code IS NULL AND catalog_version IS NULL)
    OR (
      catalog_country IS NOT NULL AND catalog_code IS NOT NULL AND catalog_version IS NOT NULL
      AND catalog_country ~ '^[A-Z]{2}$'
      AND catalog_code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
      AND length(catalog_version) BETWEEN 1 AND 40
    )
  );

CREATE UNIQUE INDEX institution_catalog_uk ON accounts.institution (workspace_id, catalog_country, catalog_code)
  WHERE archived_at IS NULL AND catalog_code IS NOT NULL;

COMMENT ON COLUMN accounts.institution.catalog_code IS
  'Código (sigla del registro oficial) de la entrada del catálogo de referencia de la que se adoptó; NULL si se creó a mano. Inmutable: renombrar la institución no lo cambia.';
COMMENT ON COLUMN accounts.institution.catalog_version IS
  'Versión del catálogo de referencia en la que se adoptó (= su fecha de corte).';

-- migrate:down
DROP INDEX accounts.institution_catalog_uk;
ALTER TABLE accounts.institution DROP CONSTRAINT institution_catalog_ref_ck;
ALTER TABLE accounts.institution
  DROP COLUMN catalog_version,
  DROP COLUMN catalog_code,
  DROP COLUMN catalog_country;
