-- IMPORTS: lectura de extractos PDF con texto (openspec add-pdf-statement-parser, tarea 4.5; design.md § Modelo de datos).
-- Expand, no destructiva; se ejecuta con `pf_migrator`. Sin tablas nuevas ni defaults que reescriban datos.
--
--   * imports.import_job.pdf         Columna nullable (jsonb) con lo que la lectura informa del documento: diseño y versión,
--     páginas leídas y declaradas, coherencia (totales, saldo corrido, líneas no reconocidas por página y número),
--     diferencia del saldo inicial con la cuenta y avisos. SOLO estructura y conteos: nunca texto del extracto, datos del
--     titular ni metadatos del PDF (NFR-SEC-015). Las políticas RLS y los grants de la tabla no cambian.
--   * imports.import_job_format_ck / import_job_source_check / imports.mapping_profile_format_check
--                                    Amplían el formato con `PDF` y la fuente con `FILE_PDF`; los jobs y perfiles previos
--     siguen válidos. Rollback: la versión anterior ignora la columna y un job PDF pendiente queda en `UPLOADED`.

-- migrate:up

ALTER TABLE imports.import_job ADD COLUMN pdf jsonb NULL;
COMMENT ON COLUMN imports.import_job.pdf IS
  'Lectura de un extracto PDF (imports/import-pipeline, FR-IMPORTS-016): diseño, páginas, coherencia y avisos. Sin texto del extracto.';

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_format_ck;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_format_ck
  CHECK (format IS NULL OR format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX', 'PDF'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check
  CHECK (source IN ('FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX', 'FILE_PDF'));

ALTER TABLE imports.mapping_profile DROP CONSTRAINT mapping_profile_format_check;
ALTER TABLE imports.mapping_profile ADD CONSTRAINT mapping_profile_format_check
  CHECK (format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX', 'PDF'));

-- migrate:down

ALTER TABLE imports.mapping_profile DROP CONSTRAINT mapping_profile_format_check;
ALTER TABLE imports.mapping_profile ADD CONSTRAINT mapping_profile_format_check
  CHECK (format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check
  CHECK (source IN ('FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_format_ck;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_format_ck
  CHECK (format IS NULL OR format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX'));

ALTER TABLE imports.import_job DROP COLUMN pdf;
