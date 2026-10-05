# Propuesta: add-classification

## Why

Ningún ingreso o gasto de Phase 1 puede registrarse con significado sin un catálogo de clasificación: `add-transaction-recording` exige que toda porción (split) de ingreso/gasto/reembolso tenga una categoría válida, las conversiones y transferencias necesitan la categoría de sistema *Comisiones*, y el dashboard básico agrega gastos por categoría. Este change convierte el diseño de Phase 0 del contexto CLASSIFICATION (docs/04 §3.5, docs/05 §2.5, docs/08 §5.5, INV-019, INV-033) en comportamiento verificable: categorías jerárquicas con tipo ingreso/gasto, categorías de sistema protegidas y traducibles, catálogo inicial opcional para un usuario en Bolivia, tags transversales y counterparties con alias. Es el change 5 del plan de docs/03 §7.

## What Changes

- Se introduce el catálogo de **categorías**: grupos de categorías, categorías y subcategorías (máximo dos niveles de categoría bajo un grupo), tipo `income`/`expense` inmutable, icono, color y orden persistente; compatibilidad tipo↔movimiento (`CATEGORY_KIND_MISMATCH`).
- Se introducen las **categorías de sistema** con código estable, provisionadas en cada workspace, no archivables ni renombrables y con nombre visible traducido (es/en/pt).
- Se introduce un **catálogo inicial sugerido en español para Bolivia**, opcional al crear el workspace y aplicable después de forma idempotente; nunca hardcodeado.
- Se introduce el **archivado en lugar de borrado** para categorías, grupos, tags y counterparties, con desarchivado, conservación del historial y rechazo de asignaciones nuevas (INV-019).
- Se introducen los **tags** (N por porción, sin doble conteo en totales) y las **counterparties** (tipo, alias únicos para reconocimiento en descripciones, categoría por defecto, sugerencia de categoría, creación inline).
- Se fija como comportamiento observable que **recategorizar, etiquetar o cambiar la counterparty no toca el ledger** (INV-033): mismos asientos y mismos saldos.
- **Fuera de alcance:** fusionar categorías, tags o counterparties (FR-CLASSIFICATION-007/013, Phase 2); custom fields (FR-CLASSIFICATION-009, Phase 2); reglas automáticas de clasificación y matching en imports (Phase 6); presupuestos por categoría/grupo/tag (Phase 2); edición masiva (FR-TRANSACTIONS-033, Phase 2); recategorizar dentro de periodos cerrados (no existe cierre hasta Phase 2). La asignación de clasificación a una transacción (`ApplyClassification`) la implementa `add-transaction-recording`; aquí solo se especifica la regla de catálogo que debe respetar.

## Capabilities

### New Capabilities
- `classification/categories`: grupos, categorías y subcategorías con tipo, icono, color y orden; categorías de sistema protegidas y traducibles; catálogo inicial; archivado/desarchivado; renombrado por identidad; recategorización sin efecto en el ledger.
- `classification/tags`: tags con nombre único y color, N por porción, archivado/desarchivado, etiquetado sin efecto en el ledger.
- `classification/counterparties`: counterparties con tipo, icono, alias únicos y reconocimiento por descripción, categoría por defecto y sugerencia, creación inline, archivado/desarchivado.

### Modified Capabilities
- Ninguna (aún no existen specs de clasificación).

## Impact

**Specs impactadas:** crea `classification/categories` (18 requirements), `classification/tags` (7) y `classification/counterparties` (9).

**Componentes/contextos impactados:** nuevo módulo `@pf/classification` (domain/application/infrastructure/interface); Identity (`CreateWorkspace` invoca la provisión de categorías de sistema y, opcionalmente, del catálogo inicial en la misma unidad de trabajo); Transactions consume la query pública `ValidateClassification` y `GetCategorySuggestion` necesita `LastCategoryUsedWithCounterparty` de Transactions; Reporting (dashboard) lee nombres/estado de categorías y grupos; Audit (puerto síncrono); `apps/web` (pantallas de categorías, tags y counterparties, selectores y creación inline). Detalle en design.md.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevas operaciones `unarchiveCategory`, `unarchiveCategoryGroup`, `unarchiveTag`, `unarchiveCounterparty`, `reorderCategories`, `applyDefaultCategoryCatalog`, `resolveCounterparty`, `getCounterpartyCategorySuggestion`; cambios de schemas `Category` (`systemCode` ampliado, `isSystem`), `CounterpartyKind` (+`FINANCIAL_INSTITUTION`), `Counterparty*` (`icon`; `kind` opcional en create), `WorkspaceCreate` (`seedDefaultCategories`); nuevos códigos `CATEGORY_DEPTH_EXCEEDED`, `CATEGORY_GROUP_NOT_EMPTY`, `COUNTERPARTY_ALIAS_TAKEN`. Lista exacta en design.md §Contratos.

**Tablas impactadas:** `classification.category_group`, `classification.category`, `classification.tag`, `classification.counterparty`, `classification.counterparty_alias`, `classification.category_name_i18n` (nueva, nombres de sistema por locale). Todas con RLS `WS`.

**Eventos impactados:** produce `classification.CategoryArchived.v1` (nuevo schema en `contracts/events/classification/`). No consume eventos en Phase 1 (la provisión es síncrona). `classification.CategoriesMerged.v1` y demás merges quedan para Phase 2.

**Migraciones requeridas:** solo *expand* (creación del schema `classification` y sus tablas, índices, triggers de profundidad/tipo/sistema, grants sin `DELETE`). No destructiva. Migración de datos de referencia para los nombres traducidos de las categorías de sistema.

**Test cases:** AÑADIDOS — TC-CLASSIFICATION-CATEGORY-001, TC-CLASSIFICATION-HIERARCHY-001, TC-CLASSIFICATION-KIND-001, TC-CLASSIFICATION-KIND-002, TC-CLASSIFICATION-ARCHIVE-002, TC-CLASSIFICATION-ARCHIVE-003, TC-CLASSIFICATION-RENAME-001, TC-CLASSIFICATION-SYSTEM-001, TC-CLASSIFICATION-SYSTEM-002, TC-CLASSIFICATION-SYSTEM-003, TC-CLASSIFICATION-SEED-001, TC-CLASSIFICATION-TAG-001, TC-CLASSIFICATION-TAG-002, TC-CLASSIFICATION-TAG-003, TC-CLASSIFICATION-TAG-004, TC-CLASSIFICATION-TAG-005, TC-CLASSIFICATION-TAG-006, TC-CLASSIFICATION-COUNTERPARTY-001, TC-CLASSIFICATION-COUNTERPARTY-002, TC-CLASSIFICATION-COUNTERPARTY-003, TC-CLASSIFICATION-COUNTERPARTY-004, TC-CLASSIFICATION-COUNTERPARTY-005, TC-CLASSIFICATION-ALIAS-001, TC-CLASSIFICATION-ALIAS-002. MODIFICADOS — TC-CLASSIFICATION-ARCHIVE-001 (requirement firme), TC-CLASSIFICATION-DELETE-001 (ahora verifica que no existe eliminación, solo archivado; INV-019), TC-CLASSIFICATION-RECATEGORIZE-001 (requirement firme; invariante INV-033). DEPRECADOS — ninguno. Los requirements Should (desarchivar, reordenar, grupos, sugerencia) reciben TCs en los grupos de tareas correspondientes: AÑADIDOS (2026-10-04, tarea 1.3) — TC-CLASSIFICATION-UNARCHIVE-001, TC-CLASSIFICATION-UNARCHIVE-002, TC-CLASSIFICATION-UNARCHIVE-003, TC-CLASSIFICATION-ORDER-001, TC-CLASSIFICATION-GROUP-001, TC-CLASSIFICATION-GROUP-002, TC-CLASSIFICATION-SUGGESTION-001.

**Impacto de regresión:** ninguno sobre comportamiento existente (solo existe la plataforma). A partir de aquí la Financial Regression Suite incluye INV-019 e INV-033; `add-transaction-recording` depende de `ValidateClassification` y de las categorías de sistema `UNCATEGORIZED`/`FEES`.

**Riesgos introducidos:** la validación de referencias cruzadas Transactions→Classification es lógica (sin FK entre schemas) y podría quedar inconsistente si se omite la query (mitigado con `ValidateClassification` obligatoria y job de verificación); la sugerencia por "última categoría usada" introduce una dependencia de lectura Classification→Transactions (aceptable, vía puerto); falsos positivos en el reconocimiento por alias (alias cortos) — mitigado con longitud mínima de alias. Sin RISK-ids nuevos registrados.

**Invariantes afectadas:** INV-019 (catálogos archivados nunca dejan transacciones huérfanas; solo soft-archive) e INV-033 (recategorizar o etiquetar nunca crea, modifica ni revierte asientos). No se toca dinero, FX, periodos ni redondeo.
