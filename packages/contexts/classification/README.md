# @pf/classification — bounded context CLASSIFICATION

Catálogos de categorías (grupo → categoría → subcategoría), tags y counterparties (openspec `add-classification`;
capabilities `classification/categories`, `classification/tags`, `classification/counterparties`).

| Capa | Contenido |
|---|---|
| `domain` | AR `CategoryGroup`, `Category`, `Tag`, `Counterparty`; VO `NormalizedText`, `Alias`; DS `CounterpartyMatcher`; `SystemCategoryCatalog` (11 códigos) y `SystemCategoryPolicy`. Solo `@pf/shared-kernel`. |
| `application` | `ClassificationService` (comandos auditados; `classification.CategoryArchived.v1` por el outbox; provisión síncrona y catálogo inicial) y `ClassificationQueries` (listados, `ResolveCounterparty`, `GetCategorySuggestion`, `ValidateClassification`). Fakes en `application/testing`. |
| `infrastructure` | Repositorios PostgreSQL (schema `classification`, Kysely sobre la `PgUnitOfWork`), catálogo `seed/default-catalog.es-BO.v1.json`, stub de `LastCategoryUsedQueryPort`. |
| `interface` | `ClassificationModule` + controller REST (`DELETE` ⇒ 405 `METHOD_NOT_ALLOWED`). |
| `contracts` | `ClassificationValidator`, `WorkspaceCatalogProvisioner`, payload de `CategoryArchived.v1`, `CLASSIFICATION_AUDIT_POLICY`. |

Esquema de BD: `apps/api/db/migrations/20261003173000_classification_schema.sql`. Decisiones en
`openspec/changes/add-classification/design.md` § Decisiones de implementación.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios y de propiedades de dominio y aplicación (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorios, RLS y triggers contra PostgreSQL 18 (Testcontainers; requiere Docker) |
