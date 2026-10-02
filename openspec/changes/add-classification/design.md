# Diseño

## Contexto

Bounded context **CLASSIFICATION** (`classification`, `@pf/classification`, Supporting; docs/05 §2.5). Es dueño de los **catálogos** (categorías, grupos, tags, counterparties); los **valores** asignados a cada porción de transacción (categoryId, tagIds, counterpartyId) son propiedad de Transactions (docs/04 §3.5, nota final). Modelo de Phase 0: docs/04 §3.5, docs/08 §5.5, docs/10 §9.1 y tabla de recursos, docs/11, INV-019 e INV-033 (docs/09). Motivación y alcance: proposal.md.

Dependencias con otros changes de Phase 1 (orden de docs/03 §7):
- **Requiere** `bootstrap-platform-foundation` (plataforma, migraciones, trazabilidad), `add-workspace-identity` (workspace, roles `OWNER/EDITOR/VIEWER`, contexto RLS) y `add-audit-trail` (`AuditPort` síncrono).
- **Habilita** `add-transaction-recording` (usa `ValidateClassification`, categorías de sistema `UNCATEGORIZED`/`UNCATEGORIZED_INCOME`; implementa `ApplyClassification` y emite `transactions.TransactionCategorized.v1`), `add-transfers` y `add-manual-conversions` (fees con `FEES`/`FX_FEES`) y `add-basic-dashboard` (gasto por categoría/grupo).
- Los requirements "Recategorizar/Etiquetar/Cambiar counterparty no modifica el ledger" y "Compatibilidad del tipo" se verifican de punta a punta solo cuando `add-transaction-recording` existe; sus TCs se automatizan en ese change si este se aplica antes (ver tasks 7.x).

## Objetivos / No objetivos

**Objetivos:**
- Agregados `CategoryGroup`, `Category`, `Tag`, `Counterparty` con archivado/desarchivado, optimistic locking y auditoría.
- Categorías de sistema provisionadas de forma síncrona al crear el workspace, con nombres traducidos.
- Catálogo inicial para Bolivia como datos versionados aplicables de forma idempotente.
- Queries públicas para otros contextos: `ValidateClassification`, `GetCategoryTree`, `ResolveCounterparty`, `GetCategorySuggestion`.

**No objetivos:**
- Fusión de catálogos (`MergeCategories`, `MergeTags`, `MergeCounterparties`; Phase 2), custom fields (Phase 2), reglas e imports (Phase 6), presupuestos (Phase 2).
- Asignar clasificación a transacciones (Transactions) y totales de reportes (Reporting): aquí solo se exponen catálogos y validación.

## Decisiones

### 1. Agregados y capas

| Capa | Elementos |
|---|---|
| domain | AR `CategoryGroup {id, kind, name, sortOrder, status}`; AR `Category {id, groupId, parentId?, kind, name, systemCode?, icon, color, sortOrder, status}`; AR `Tag {id, name, color, status}`; AR `Counterparty {id, name, normalizedName, kind, icon, defaultCategoryId?, aliases: VO Alias[], notes, website, status}`; VO `NormalizedText` (minúsculas, sin acentos — NFD + quitar diacríticos —, espacios colapsados); DS `CounterpartyMatcher`; política `SystemCategoryPolicy`; catálogo `SystemCategoryCatalog` (códigos y tipos). Sin dependencias de framework. |
| application | Comandos `CreateCategoryGroup`, `UpdateCategoryGroup`, `ArchiveCategoryGroup`, `UnarchiveCategoryGroup`, `CreateCategory`, `UpdateCategory` (renombrar, mover, icono, color, orden), `ArchiveCategory` (cascada a subcategorías), `UnarchiveCategory`, `ReorderCategories`, `ProvisionSystemCategories`, `ApplyDefaultCategoryCatalog`, `CreateTag`, `UpdateTag`, `ArchiveTag`, `UnarchiveTag`, `CreateCounterparty`, `UpdateCounterparty`, `ArchiveCounterparty`, `UnarchiveCounterparty`. Queries `ListCategories`, `GetCategoryTree`, `ListCategoryGroups`, `ListTags`, `ListCounterparties`, `ResolveCounterparty(description)`, `GetCategorySuggestion(counterpartyId, kind)`, `ValidateClassification(categoryIds, tagIds, counterpartyId, splitKinds)`. Puertos de salida: `CategoryRepository`, `CategoryGroupRepository`, `TagRepository`, `CounterpartyRepository`, `AuditPort` (sync), `OutboxPort`, `LastCategoryUsedQueryPort` (implementado por Transactions), `Clock`, `IdGenerator`, `LocaleResolver`. |
| infrastructure | Repositorios PostgreSQL (schema `classification`), adaptador del outbox (`platform.outbox`), adaptador de `LastCategoryUsedQueryPort` que llama al `contracts` público de Transactions (in-process), cargador del catálogo inicial (archivo de datos versionado). |
| interface | Controladores REST bajo `/api/v1/workspaces/{workspaceId}/…` (problem+json, `ETag`/`If-Match`, `Idempotency-Key` en POST de creación); módulo público `contracts` del paquete para queries in-process. |

### 2. Jerarquía: grupo → categoría → subcategoría
Se adopta el modelo de docs/08 §5.5 y del contrato OpenAPI: toda categoría pertenece a un `CategoryGroup` del mismo `kind`, y `parentId` admite un único nivel de subcategoría. FR-CLASSIFICATION-001 ("categoría → subcategoría, máximo 2 niveles") se cumple sobre la jerarquía de categorías; el grupo es un nivel de agregación adicional (FR-CLASSIFICATION-006). Una subcategoría hereda `groupId` y `kind` del padre; mover un padre mueve sus subcategorías. Profundidad > 2 ⇒ `CATEGORY_DEPTH_EXCEEDED` (dominio + trigger de defensa).

### 3. Sin eliminación (INV-019)
No existe operación `DELETE` para categorías, grupos, tags ni counterparties (docs/10 §3: nunca `DELETE` sobre datos financieros; docs/08 §1.2/§6: hard delete prohibido, sin grant `DELETE`). Una solicitud `DELETE` sobre estos recursos responde `405 Method Not Allowed` (problem+json) y no altera nada. Esto resuelve la ambigüedad de FR-CLASSIFICATION-002 ("las referenciadas no deben eliminarse") a favor del soft-archive universal: tampoco se eliminan las no referenciadas.

### 4. Archivado, desarchivado y unicidad
- `archivedAt/archivedBy`; unicidad de nombres solo entre activos (índices parciales `WHERE archived_at IS NULL`), por eso desarchivar valida `NAME_TAKEN`.
- Archivar una categoría archiva sus subcategorías activas en la misma transacción de BD y emite un `classification.CategoryArchived.v1` por cada categoría archivada.
- Un grupo solo se archiva si todas sus categorías están archivadas (`CATEGORY_GROUP_NOT_EMPTY`).
- Desarchivar una subcategoría con padre archivado ⇒ `CATEGORY_ARCHIVED`.
- Listados excluyen archivados salvo `includeArchived=true`; `ValidateClassification` rechaza referencias archivadas con `CATEGORY_ARCHIVED` / `TAG_ARCHIVED` / `COUNTERPARTY_ARCHIVED` para porciones **nuevas o modificadas**; las porciones existentes conservan su referencia (Transactions solo valida los IDs que cambian).

### 5. Normalización de nombres
Categorías: único por `(workspace_id, group_id, coalesce(parent_id, nil), lower(name))` entre activas (cambio respecto de docs/08 §5.5, que usa `(workspace_id, group_id, lower(name))` y prohibiría "Otros" bajo dos padres del mismo grupo). Tags y counterparties: único por `normalized_name` (minúsculas, sin acentos, espacios colapsados). Alias: `alias_normalized` único por workspace (`COUNTERPARTY_ALIAS_TAKEN`), longitud mínima 3 caracteres normalizados para limitar falsos positivos.

### 6. Categorías de sistema
Provisionadas por `ProvisionSystemCategories`, invocado **síncronamente** por la capa de composición dentro de la unidad de trabajo de `CreateWorkspace` (el contrato de `createWorkspace` ya promete que existen al responder; Transactions necesita `UNCATEGORIZED` desde la primera transacción). Idempotente por `(workspace_id, system_code)`. docs/05 §2.5 describe esta provisión como consumo asíncrono de `identity.WorkspaceCreated`; se elige la vía síncrona por la garantía anterior (ver Preguntas abiertas).

| `systemCode` | Tipo | es (por defecto) | en | pt | Grupo inicial |
|---|---|---|---|---|---|
| `FEES` | EXPENSE | Comisiones | Fees | Tarifas | Finanzas |
| `FX_FEES` | EXPENSE | Comisiones de cambio | FX fees | Tarifas de câmbio | Finanzas |
| `INTEREST` | EXPENSE | Intereses pagados | Interest paid | Juros pagos | Finanzas |
| `LOAN_FEES` | EXPENSE | Comisiones de préstamo | Loan fees | Tarifas de empréstimo | Finanzas |
| `INSURANCE` | EXPENSE | Seguros | Insurance | Seguros | Finanzas |
| `TAXES` | EXPENSE | Impuestos | Taxes | Impostos | Finanzas |
| `ADJUSTMENTS` | EXPENSE | Ajustes | Adjustments | Ajustes | Otros gastos |
| `UNCATEGORIZED` | EXPENSE | Sin categoría | Uncategorized | Sem categoria | Otros gastos |
| `INTEREST_EARNED` | INCOME | Intereses ganados | Interest earned | Juros recebidos | Otros ingresos |
| `ADJUSTMENTS_INCOME` | INCOME | Ajustes | Adjustments | Ajustes | Otros ingresos |
| `UNCATEGORIZED_INCOME` | INCOME | Sin categoría | Uncategorized | Sem categoria | Otros ingresos |

- Los grupos "Finanzas", "Otros gastos" y "Otros ingresos" se crean junto con las categorías de sistema (son grupos de usuario comunes: renombrables; no archivables mientras contengan una categoría de sistema, por la regla de grupo no vacío).
- Se necesitan dos "Sin categoría" y dos "Ajustes" (uno por tipo) porque la regla de compatibilidad de tipo aplica también a las categorías de sistema (un ingreso sin categoría no puede caer en una categoría de gasto) y porque los ajustes categorizados pueden ser ±EXPENSE/INCOME (docs/09 §6.17).
- `OPENING_BALANCE` **no** se provisiona como categoría: un `OPENING_BALANCE` postea contra `EQUITY:OPENING_BALANCE:<CCY>` con 0 porciones (docs/09 §6.17), por lo que una categoría nunca sería referenciada. Esto contradice la lista de FR-CLASSIFICATION-003; queda en Preguntas abiertas.
- Nombre visible: tabla `classification.category_name_i18n (system_code, locale, name)` (datos de referencia globales vía migración, RLS `WS+G` con filas globales de solo lectura); la API resuelve `name` según el locale del usuario (`Me.locale`, fallback `es`). La UI no traduce por su cuenta.
- `SystemCategoryPolicy`: no archivar, no renombrar, no cambiar `kind`, no asignar `parentId`, ni ser padre de subcategorías ⇒ `SYSTEM_CATEGORY_IMMUTABLE`. Icono, color, orden y grupo (mismo tipo) sí son editables. Trigger de BD de defensa contra archivado/renombrado.

### 7. Catálogo inicial (FR-CLASSIFICATION-004)
Archivo de datos versionado `packages/classification/src/infrastructure/seed/default-catalog.es-BO.v1.json` (no código), aplicado por `ApplyDefaultCategoryCatalog`: (a) desde `CreateWorkspace` cuando `seedDefaultCategories=true` (por defecto `true`); (b) a demanda vía `POST …/categories/apply-default-catalog`. Idempotente: crea solo los grupos/categorías cuyo nombre normalizado no exista activo en el mismo nivel; responde con conteo de creados/omitidos. Las categorías creadas son de usuario (`systemCode = null`). Los colores usan la paleta de docs/28; los iconos son claves del set de iconos de la UI.

Catálogo v1 (G = grupo; categorías en negrita; subcategorías entre paréntesis):

**Gasto (EXPENSE)**
- G **Vivienda**: **Alquiler**; **Expensas y condominio**; **Servicios básicos** (Luz, Agua, Gas domiciliario, Internet, Telefonía móvil, TV cable); **Mantenimiento y reparaciones**.
- G **Alimentación**: **Supermercado** (Mercado, Supermercado y minimarket); **Restaurantes**; **Delivery**; **Cafés y snacks**.
- G **Transporte**: **Combustible**; **Transporte público** (Minibús y micro, Teleférico); **Taxi y apps de transporte**; **Vehículo** (Mantenimiento, SOAT y seguro vehicular, Impuesto vehicular, Estacionamiento y peajes).
- G **Salud**: **Consultas médicas**; **Farmacia**; **Seguro de salud**; **Dental y óptica**.
- G **Educación**: **Colegio y pensiones**; **Universidad**; **Cursos e idiomas**; **Útiles y libros**.
- G **Hogar y personal**: **Hogar** (Artículos de limpieza, Muebles y equipamiento, Trabajadora del hogar); **Ropa y calzado**; **Cuidado personal** (Peluquería, Cosméticos).
- G **Ocio**: **Entretenimiento**; **Viajes**; **Suscripciones digitales**; **Deporte y gimnasio**; **Salidas y fiestas**.
- G **Familia**: **Hijos**; **Mascotas**; **Regalos y celebraciones**; **Apoyo familiar**; **Donaciones y diezmo**.
- G **Finanzas**: solo las categorías de sistema de gasto (`FEES`, `FX_FEES`, `INTEREST`, `LOAN_FEES`, `INSURANCE`, `TAXES`); las ganancias/pérdidas cambiarias no son categorías (viven en `EQUITY:FX_TRADING`, docs/09).
- G **Otros gastos** (con `ADJUSTMENTS`, `UNCATEGORIZED`): **Varios**.

**Ingreso (INCOME)**
- G **Ingresos laborales**: **Sueldo**; **Aguinaldo**; **Bonos y horas extra**; **Honorarios y freelance**.
- G **Inversiones**: **Rendimientos de inversiones** (DPF, Fondos de inversión, Staking y rendimientos cripto); **Dividendos**.
- G **Otros ingresos** (con `INTEREST_EARNED`, `ADJUSTMENTS_INCOME`, `UNCATEGORIZED_INCOME`): **Alquileres cobrados**; **Ventas**; **Regalos recibidos**; **Reembolsos de terceros**; **Varios**.

> Total v1: 13 grupos (3 de ellos compartidos con las categorías de sistema), 67 categorías y subcategorías de usuario (53 de gasto, 14 de ingreso). El conteo exacto lo fija el archivo de datos y lo verifica TC-CLASSIFICATION-SEED-001.

### 8. Counterparties
- `kind`: `MERCHANT | PERSON | EMPLOYER | SERVICE_PROVIDER | FINANCIAL_INSTITUTION | LENDER | EXCHANGE | P2P_TRADER | GOVERNMENT | OTHER` (se añade `FINANCIAL_INSTITUTION` por FR-CLASSIFICATION-010 "institution"). Default `OTHER` en creación inline.
- `ResolveCounterparty(description)`: normaliza el texto y busca nombres/alias activos contenidos en él (coincidencia de subcadena sobre texto normalizado; desempate por alias más largo, luego por nombre); `pg_trgm` queda para sugerencias difusas en Phase 6.
- `GetCategorySuggestion`: `defaultCategoryId` activa y del tipo pedido; si no, `LastCategoryUsedQueryPort` (última porción no anulada con esa counterparty y categoría activa del mismo tipo); si no, vacío. Nunca asigna.
- Creación inline = `POST /counterparties` con solo `name`; `NAME_TAKEN` incluye `existingId` en el problem+json.

### 9. Recategorización fuera del ledger (INV-033)
Classification no tiene puerto hacia Ledger (verificado por regla de dependency-cruiser: `classification` no importa `ledger`). La recategorización la ejecuta Transactions (`ApplyClassification`) actualizando solo la porción y emitiendo `transactions.TransactionCategorized.v1`; el test de INV-033 cuenta asientos/postings y compara saldos antes/después.

### 10. Datos (schema `classification`, migración *expand*)
| Tabla | Cambios / notas | RLS |
|---|---|---|
| `classification.category_group` | Según docs/08 §5.5 (+ `archived_by`, columnas estándar). | WS |
| `classification.category` | Según docs/08 §5.5; `system_code` CHECK ampliado a los 11 códigos de §6; unique `(workspace_id, system_code)`; unique de nombre por `(workspace_id, group_id, coalesce(parent_id, nil_uuid), lower(name)) WHERE archived_at IS NULL`; triggers: `kind` = `kind` del grupo y del padre, profundidad ≤ 2, sistema no archivable/renombrable. | WS |
| `classification.category_name_i18n` | Nueva: `(system_code, locale) PK, name`; datos de referencia globales vía migración. | WS+G (solo filas globales; escritura solo migración) |
| `classification.tag` | `normalized_name` añadido; unique `(workspace_id, normalized_name) WHERE archived_at IS NULL`. | WS |
| `classification.counterparty` | Según docs/08 §5.5 + `icon`; `kind` CHECK con `FINANCIAL_INSTITUTION`. | WS |
| `classification.counterparty_alias` | Según docs/08 §5.5; CHECK `length(alias_normalized) >= 3`. | WS |

Grants: `pf_app`/`pf_worker` con `SELECT, INSERT, UPDATE` (sin `DELETE`, docs/08 §6); `counterparty_alias` admite `DELETE` (tabla de enlace: quitar un alias no borra historia). FKs intra-schema compuestas con `workspace_id`. Las referencias desde `txn.transaction_split`/`txn.split_tag` son lógicas (sin FK entre schemas), validadas con `ValidateClassification`.

### 11. Eventos
- **Produce** `classification.CategoryArchived.v1` (outbox, misma transacción que el archivado). Payload: `categoryId`, `parentId|null`, `groupId`, `kind`, `archivedAt`, `cascadedFromCategoryId|null`. Idempotencia natural del consumidor: `(categoryId, aggregateVersion)` vía `platform.inbox`. Consumidores: REPORTING (marca "archivada" en el read model del dashboard); PLANNING y RULES a partir de sus fases.
- **No consume** eventos en Phase 1. `transactions.TransactionCategorized.v1` (existente) lo produce Transactions.
- Merges (`CategoriesMerged`, `TagsMerged`, `CounterpartiesMerged`) quedan para Phase 2.

### 12. Seguridad
`VIEWER` solo lectura; `EDITOR`/`OWNER` crean, editan, archivan y aplican el catálogo (x-required-role del contrato). Todo comando se audita con diff (`AuditPort`). Nombres de counterparties no se registran en logs (pueden ser personas).

## Contratos

Cambios exactos requeridos (NO aplicados aquí; los consolida el proceso de contratos):

**`contracts/openapi/finance-api.v1.yaml`**
1. `POST /workspaces/{workspaceId}/categories/{categoryId}/unarchive` — `operationId: unarchiveCategory`, `x-openspec-capability: classification/categories`, `x-required-role: EDITOR`, `If-Match` obligatorio; 200 `Category`; 409 `CATEGORY_ARCHIVED` (padre archivado) / `NAME_TAKEN`; 412/428.
2. `POST /workspaces/{workspaceId}/category-groups/{categoryGroupId}/unarchive` — `unarchiveCategoryGroup`, EDITOR, `If-Match`; 200 `CategoryGroup`; 409 `NAME_TAKEN`.
3. `POST /workspaces/{workspaceId}/tags/{tagId}/unarchive` — `unarchiveTag`, `classification/tags`, EDITOR, `If-Match`; 200 `Tag`; 409 `NAME_TAKEN`.
4. `POST /workspaces/{workspaceId}/counterparties/{counterpartyId}/unarchive` — `unarchiveCounterparty`, `classification/counterparties`, EDITOR, `If-Match`; 200 `Counterparty`; 409 `NAME_TAKEN` / `COUNTERPARTY_ALIAS_TAKEN`.
5. `POST /workspaces/{workspaceId}/categories/reorder` — `reorderCategories`, EDITOR; body `CategoryReorder {groupId: Uuid, parentId: Uuid|null, orderedIds: Uuid[] (minItems 1)}`; 200 `CategoryPage`; 422 `VALIDATION_FAILED` si `orderedIds` no es exactamente el conjunto de hermanas activas.
6. `POST /workspaces/{workspaceId}/categories/apply-default-catalog` — `applyDefaultCategoryCatalog`, EDITOR, `Idempotency-Key`; body opcional `{catalogVersion: string, default "es-BO.v1"}`; 200 `DefaultCatalogResult {catalogVersion, createdGroups: int, createdCategories: int, skipped: int}`.
7. `GET /workspaces/{workspaceId}/counterparties/resolve?description=<texto>` — `resolveCounterparty`, `classification/counterparties`, VIEWER; 200 `CounterpartyResolution {counterparty: Counterparty|null, matchedOn: NAME|ALIAS|null, matchedText: string|null}`.
8. `GET /workspaces/{workspaceId}/counterparties/{counterpartyId}/category-suggestion?kind=EXPENSE|INCOME` — `getCounterpartyCategorySuggestion`, VIEWER; 200 `CategorySuggestion {categoryId: Uuid|null, source: DEFAULT|LAST_USED|NONE}`.
9. `archiveCategoryGroup`: añadir respuesta 409 con `CATEGORY_GROUP_NOT_EMPTY`; `archiveCategory`: 409 `SYSTEM_CATEGORY_IMMUTABLE` explícito; `createCategory`/`updateCategory`: 422 `CATEGORY_DEPTH_EXCEEDED`, 422 `CATEGORY_KIND_MISMATCH`, 409 `SYSTEM_CATEGORY_IMMUTABLE`, 409 `NAME_TAKEN`, 409 `CATEGORY_ARCHIVED` (padre archivado).
10. Schema `Category`: `systemCode` enum → `[FEES, FX_FEES, INTEREST, LOAN_FEES, INSURANCE, TAXES, ADJUSTMENTS, UNCATEGORIZED, INTEREST_EARNED, ADJUSTMENTS_INCOME, UNCATEGORIZED_INCOME, null]`; añadir `isSystem: boolean` (required, derivado) y documentar que `name` se devuelve en el locale del usuario para categorías de sistema.
11. Schema `CounterpartyKind`: añadir `FINANCIAL_INSTITUTION`. `Counterparty`, `CounterpartyCreate`, `CounterpartyUpdate`: añadir `icon` (`string|null`, maxLength 50). `CounterpartyCreate.required` → `[name]` (`kind` default `OTHER`). `aliases.items.minLength: 3`.
12. Schema `WorkspaceCreate` (Identity): añadir `seedDefaultCategories: boolean, default true` (coordinar con `add-workspace-identity`).
13. `ErrorCode` enum y catálogo docs/10 §9.1: añadir `CATEGORY_DEPTH_EXCEEDED` (422), `CATEGORY_GROUP_NOT_EMPTY` (409), `COUNTERPARTY_ALIAS_TAKEN` (409). El problem+json de `NAME_TAKEN` en counterparties incluye `existingId: Uuid`.
14. No se añade ningún `DELETE` sobre recursos de clasificación (respuesta 405 genérica).

**`contracts/events/`**
15. Nuevo `contracts/events/classification/CategoryArchived.v1.schema.json` (`eventType: classification.CategoryArchived`, `eventVersion: 1`, `aggregateType: Category`; payload de §11, todos los campos `required` con `null` explícito; ejemplo incluido) y su entrada en `contracts/events/README.md` y en el catálogo de docs/11.

> Consolidado en contracts/ el 2026-10-02.

## Riesgos / Trade-offs

- [Referencias cruzadas sin FK (txn → classification)] → `ValidateClassification` obligatoria en toda escritura de porciones + job nocturno de verificación de referencias (INV-019) en Phase 1.
- [Provisión síncrona acopla `CreateWorkspace` con Classification] → acoplamiento in-process vía puerto de composición; la operación es idempotente y barata (11 categorías de sistema + 67 del catálogo).
- [Falsos positivos de alias (p. ej. "ya")] → mínimo 3 caracteres, desempate por alias más largo; reconocimiento solo sugiere.
- [Catálogo inicial culturalmente sesgado] → es datos editables y versionados; nuevas versiones (`es-BO.v2`) se aplican de forma idempotente.
- [Duplicación de requirements de "no toca el ledger" con `add-transaction-recording`] → aquí se especifican desde el punto de vista del catálogo; si ese change define requirements equivalentes, los TCs se comparten vía `related_specs`.

## Plan de migración

Solo *expand*: `db/migrations/classification/<ts>_create_classification_schema.sql` (tablas, índices parciales, CHECKs, triggers, RLS `ENABLE/FORCE` + política `ws_isolation`, grants sin `DELETE`) y `<ts>_seed_system_category_names.sql` (datos de referencia i18n). Ninguna tabla previa cambia; rollback = revertir la migración en entornos sin datos (roll-forward en producción). Workspaces creados antes de este change (solo en dev) se reprovisionan con `ProvisionSystemCategories` idempotente vía script `db:seed`.

## Preguntas abiertas

- **OPENING_BALANCE como categoría de sistema** (FR-CLASSIFICATION-003 lo lista; docs/09 §6.17 no le asigna porciones). Decisión provisional: no se provisiona. Requiere actualizar FR-CLASSIFICATION-003 o justificar su uso en reportes.
- **Provisión síncrona vs evento `identity.WorkspaceCreated`** (docs/05 §2.5). Decisión provisional: síncrona; actualizar docs/05.
- **Cashback** aparece como categoría de sistema en el glosario de docs/04 pero no en FR-CLASSIFICATION-003; no se provisiona.
- **Recategorizar en periodo cerrado** (TC-CLASSIFICATION-RECATEGORIZE-001, INV-015): no aplica en Phase 1 (sin cierre de mes); se decide en Phase 2 (`planning/month-closing`).
