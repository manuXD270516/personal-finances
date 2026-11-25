-- IMPORTS: sugerencia de categoría por historial en la fila de staging (openspec add-category-suggestions, tarea 4.1).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * suggested_category  jsonb NULL   La sugerencia de RULES (`categoryId`, `confidence`, `level`, `support`, `matches`,
--     `basis`, `descriptionKey`, `counterpartyId`) para la fila que quedó sin categoría después de las reglas y de la
--     categoría por defecto de la contraparte. Nunca se aplica sola: es una propuesta.
--   * suggestion_accepted boolean NOT NULL DEFAULT false   El usuario aceptó la sugerencia (marca para la tasa de aceptación).
--   La columna nueva es nullable y el default es constante: no reescribe la tabla.
-- La tabla ya tiene RLS forzada y el registro en platform.workspace_scoped_table (imports_schema).

-- migrate:up
ALTER TABLE imports.staged_transaction
  ADD COLUMN suggested_category jsonb NULL,
  ADD COLUMN suggestion_accepted boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN imports.staged_transaction.suggested_category IS
  'Sugerencia de categoría por historial (classification/auto-classification): propuesta, nunca aplicada sin una acción del usuario.';
COMMENT ON COLUMN imports.staged_transaction.suggestion_accepted IS
  'El usuario aceptó la sugerencia de categoría de la fila (la categoría queda editada con origen manual).';

-- migrate:down
ALTER TABLE imports.staged_transaction DROP COLUMN suggestion_accepted, DROP COLUMN suggested_category;
