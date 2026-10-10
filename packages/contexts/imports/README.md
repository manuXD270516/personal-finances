# @pf/imports — bounded context IMPORTS

Importación CSV básica de una cuenta (openspec `add-basic-csv-import`; capability `imports/import-pipeline`,
FR-IMPORTS-003, Could, Phase 3). Es un **subconjunto compatible** del pipeline de [docs/13](../../../docs/13-import-architecture.md):
Phase 6 lo extiende (documentos, perfiles de mapeo, reglas, OFX/QIF/XLSX, fusión, reconciliación, deshacer) sin migraciones
destructivas ni cambios rompedores de API.

Flujo: **subir** (multipart, ≤ 2 MiB, el archivo NO se guarda: solo sus celdas) → **mapear** (columnas, formato de fecha y
separador decimal explícitos; clasificación síncrona) → **revisar** (nuevas, ya importadas, posibles duplicados, inválidas)
→ **aprobar** → el worker crea **una transacción `POSTED` sin categoría por fila**, por lotes de 200.

| Capa | Contenido |
|---|---|
| `domain` | AR `ImportJob` (estados del subconjunto, contadores, versión); servicios puros `CsvSniffer` (codificación UTF-8/windows-1252, binario, delimitador, RFC 4180), `CsvMapping`, `RowNormalizer` (fecha estricta, monto exacto con `Decimal`, descripción saneada), `RowValidator` (cero, fecha futura, periodo cerrado), `RowFingerprint` (SHA-256 puro + `occurrenceIndex`), `DuplicateClassifier` (exacto por vínculo, probable por candidato, asignación 1:1 determinista) e `ImportBatchPlanner`. Sin Nest, Kysely ni módulos de Node. |
| `application` | `ImportsService` (subir, mapear, decidir fila, aprobar, cancelar, reintentar, aceptar errores), `ImportsQueries` (lista, detalle, vista previa), `PersistImportService` (consumidor del worker; un lote = una transacción de base de datos) e `ImportsMaintenanceService` (expirar revisiones y purgar celdas). Dobles en `application/testing`. |
| `infrastructure` | Repositorios Kysely/SQL (`imports.*`, inserciones y actualizaciones por `jsonb_array_elements` en chunks de 1 000), `PgImportsUnitOfWork` (con `runDetached` para el lote dentro del consumidor). |
| `interface` | `ImportsModule` + `ImportsController` (`/imports*`, guard `CsvUploadGuard`: lee el multipart con tope antes de la idempotencia), consumidor `imports.persist` y jobs `imports.expire-reviews` / `imports.purge-staging`. |
| `contracts` | Eventos `imports.ImportApproved.v1` / `imports.ImportCompleted.v1` (nunca por fila), `IMPORTS_AUDIT_POLICY` y las secciones de portabilidad (órdenes 770–771). |

Dependencias: solo `contracts` de Transactions (`ImportedTransactionsCommand.recordBatch`, `DuplicateCandidatesQuery.findForImport`,
`TransactionStatusQuery.statusOf`), Accounts, Ledger, Planning, Identity y Audit, y `@pf/shared-kernel`/`@pf/platform`.

Seguridad: los textos importados son datos no confiables (se guardan sin interpretar, la UI los escapa y todo CSV que exporta
el sistema neutraliza `= + - @ \t \r`); los logs llevan solo `importJobId`, conteos, códigos y números de línea; RLS forzada
por workspace; límites de tamaño, filas y columnas; cuota `costly` al subir, mapear, aprobar y reintentar.

Esquema de BD: `apps/api/db/migrations/20261010400000_txn_import_job_id.sql`, `20261010400100_txn_import_ref_uk.sql` e
`20261010400200_imports_schema.sql`. Decisiones en `openspec/changes/add-basic-csv-import/design.md`; operación en
[`docs/runbooks/importar-extracto-csv.md`](../../../docs/runbooks/importar-extracto-csv.md).

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios, propiedades y aplicación con dobles en memoria (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorios, RLS, permisos e índices contra PostgreSQL 18 (Testcontainers; requiere Docker). Las pruebas de API y del worker viven en `apps/api/test/api/imports.api.test.ts` |
