# Tareas

> Requiere `bootstrap-platform-foundation`, `add-workspace-identity` y `add-audit-trail` aplicados. Los cambios de contrato listados en design.md §Contratos deben estar consolidados en `contracts/` antes del grupo 5.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar las specs `classification/categories`, `classification/tags` y `classification/counterparties` con el owner y resolver las preguntas abiertas de design.md (OPENING_BALANCE, provisión síncrona); verificar con `openspec validate add-classification --strict`
  > Revisado 2026-10-04 (sigue pendiente del owner): `OPENING_BALANCE` y `Cashback` quedan resueltos por docs/31 D9 (la lista canónica de 11 códigos del design no los incluye), además de D7/D8. Siguen abiertas sin decisión en docs/31: provisión síncrona vs `identity.WorkspaceCreated` (implementada síncrona y documentada en docs/05 §2.5 como decisión provisional) y recategorizar en periodo cerrado (diferida a Phase 2).
  > Revisado 2026-10-05: recategorizar en periodo cerrado quedó resuelto por el owner (docs/31 D49: se rechaza con `PERIOD_CLOSED`; escenario nuevo y TC-CLASSIFICATION-RECATEGORIZE-002). Sigue abierta la provisión síncrona vs `identity.WorkspaceCreated`, por eso 1.1 no se cierra.
- [x] 1.2 Confirmar los TC MODIFICADOS (TC-CLASSIFICATION-ARCHIVE-001, -DELETE-001, -RECATEGORIZE-001) y los 24 AÑADIDOS en `tests/cases/classification/`; verificar que el chequeo del catálogo de trazabilidad los acepta y que todo requirement Must tiene ≥ 1 TC
- [x] 1.3 Redactar los TC de los requirements Should (desarchivar categoría/tag/counterparty, orden persistente, grupos, grupo no vacío, sugerencia de categoría); verificar con el chequeo del catálogo
  > Verificado 2026-10-04 (pendiente): ningún TC de `tests/cases/classification/` cubre los 7 requirements Should (desarchivar categoría/tag/counterparty, orden persistente, grupos, grupo no vacío, sugerencia por counterparty).
  > Hecho (2026-10-04): TC de los 7 requirements Should en `tests/cases/classification/`: UNARCHIVE-001 (categoría), UNARCHIVE-002 (tag), UNARCHIVE-003 (counterparty), ORDER-001, GROUP-001 (total por grupo), GROUP-002 (grupo no vacío) y SUGGESTION-001; declarados en proposal.md (Test Impact). Automatizados en `apps/api/test/api/classification-should.api.test.ts` salvo GROUP-001 (`not_automated`: Phase 1 no expone un reporte por grupo). `pnpm traceability:check` en verde.

## 2. DOMAIN — categorías y grupos (TDD)

- [x] 2.1 Test-first: `NormalizedText` (mayúsculas, acentos, espacios) con tests unitarios y de propiedades; verificar que pasan
- [x] 2.2 Test-first: AR `CategoryGroup` y `Category` — tipo inmutable, profundidad ≤ 2 (`CATEGORY_DEPTH_EXCEEDED`), herencia de grupo/tipo, `CATEGORY_KIND_MISMATCH`, archivado en cascada, desarchivado con padre archivado; tests de dominio nombrados con TC-CLASSIFICATION-HIERARCHY-001, -KIND-001, -ARCHIVE-003
- [x] 2.3 Test-first: `SystemCategoryPolicy` y `SystemCategoryCatalog` (11 códigos, tipos, prohibiciones `SYSTEM_CATEGORY_IMMUTABLE`); tests nombrados con TC-CLASSIFICATION-SYSTEM-001, -SYSTEM-002
- [x] 2.4 Test-first: invariante INV-019 como test de propiedades (∀ secuencia crear/asignar/archivar/desarchivar: toda referencia resuelve a una categoría existente); verificar con TC-CLASSIFICATION-DELETE-001

## 3. DOMAIN — tags y counterparties (TDD)

- [x] 3.1 Test-first: AR `Tag` (nombre normalizado único, archivado, desarchivado); tests nombrados con TC-CLASSIFICATION-TAG-001, -TAG-003
- [x] 3.2 Test-first: AR `Counterparty` y VO `Alias` (mínimo 3 caracteres, únicos), `CounterpartyMatcher` (subcadena normalizada, desempate por alias más largo, ignora archivadas); tests nombrados con TC-CLASSIFICATION-COUNTERPARTY-001, -ALIAS-001, -ALIAS-002

## 4. APPLICATION

- [x] 4.1 Casos de uso de categorías/grupos (crear, actualizar, mover, archivar, desarchivar, reordenar) con `AuditPort` y outbox de `classification.CategoryArchived.v1`; tests de aplicación con fakes nombrados con TC-CLASSIFICATION-CATEGORY-001, -RENAME-001, -ARCHIVE-001
- [x] 4.2 `ProvisionSystemCategories` (idempotente) cableado en la composición de `CreateWorkspace`; verificar que un workspace nuevo tiene exactamente las 11 categorías de sistema (TC-CLASSIFICATION-SYSTEM-001)
- [x] 4.3 `ApplyDefaultCategoryCatalog` + archivo de datos `default-catalog.es-BO.v1.json` con el catálogo de design.md §7; verificar idempotencia y conteos con TC-CLASSIFICATION-SEED-001
- [x] 4.4 Casos de uso de tags y counterparties (incl. creación inline con `existingId` en `NAME_TAKEN`) y queries `ResolveCounterparty`, `GetCategorySuggestion` (puerto `LastCategoryUsedQueryPort`); tests nombrados con TC-CLASSIFICATION-COUNTERPARTY-002, -TAG-005
- [x] 4.5 Query pública `ValidateClassification` (archivados, tipo, existencia) expuesta en `contracts` del paquete; tests nombrados con TC-CLASSIFICATION-ARCHIVE-002, -KIND-002, -TAG-004, -COUNTERPARTY-004

## 5. INFRASTRUCTURE

- [x] 5.1 Migración *expand* del schema `classification` (tablas, índices parciales, CHECKs, triggers de tipo/profundidad/sistema, RLS `ENABLE/FORCE`, grants sin `DELETE`) y migración de nombres i18n; verificar con test de migración sobre PG vacío y test de RLS/grants (Testcontainers)
- [x] 5.2 Repositorios PostgreSQL con optimistic locking y adaptador de outbox; tests de integración de repositorio nombrados con TC-CLASSIFICATION-ARCHIVE-001, -TAG-003, -COUNTERPARTY-003
- [x] 5.3 Adaptador `LastCategoryUsedQueryPort` contra el `contracts` de Transactions (stub hasta `add-transaction-recording`); verificar con test de integración
  > Corrección (2026-10-04): el composition root nunca sustituyó el stub `noTransactionsYet`, así que la sugerencia `LAST_USED` respondía siempre `NONE`. Ahora TRANSACTIONS expone `CounterpartyCategoryUsageQuery` (`@pf/transactions/contracts`, `PgCounterpartyCategoryUsage`) y `financeRuntimes` lo conecta a CLASSIFICATION; regresión `[TC-CLASSIFICATION-SUGGESTION-001]`.
- [x] 5.4 Schema de evento `classification.CategoryArchived.v1` y test de contrato del productor; verificar que el payload valida contra el schema

## 6. API

- [x] 6.1 Controladores REST de categorías, grupos, tags y counterparties según el contrato consolidado (incl. unarchive, reorder, apply-default-catalog, resolve, category-suggestion; 405 para `DELETE`); tests de API nombrados con TC-CLASSIFICATION-DELETE-001, -SYSTEM-002, -SYSTEM-003
- [x] 6.2 Resolución de nombres de categorías de sistema por locale del usuario; verificar con TC-CLASSIFICATION-SYSTEM-003
- [x] 6.3 Tests de contrato OpenAPI (respuestas validan contra el schema; códigos de error del catálogo) y autorización por rol (`VIEWER` no escribe)

## 7. Integración con Transactions (cuando exista `add-transaction-recording`)

- [x] 7.1 Test de integración INV-033: recategorizar un gasto de 150.00 BOB no cambia asientos ni saldos; nombrado con TC-CLASSIFICATION-RECATEGORIZE-001
  > Verificado 2026-10-04 (pendiente, código): no hay test `[TC-CLASSIFICATION-RECATEGORIZE-001]`; el comportamiento se cubre parcialmente con otros ids (`[TC-AUDIT-LIFECYCLE-004]`, `[TC-TRANSACTIONS-SPLIT-004]`), no en integración.
  > Hecho (2026-10-04): `[TC-CLASSIFICATION-RECATEGORIZE-001]` en `apps/api/test/api/classification-ledger.api.test.ts` (HTTP contra Transactions, Ledger y Reporting reales): huella fila a fila de asientos y postings idéntica, saldo 2,000.00 BOB, totales del mes Supermercado 150.00 → 0.00 y Hogar 0.00 → 150.00, auditoría con ambas categorías y `TransactionCategorized.v1` válido.
- [x] 7.2 Tests de integración de etiquetado y cambio de counterparty sin efecto en el ledger; nombrados con TC-CLASSIFICATION-TAG-006 y TC-CLASSIFICATION-COUNTERPARTY-005
  > Verificado 2026-10-04 (pendiente, código): no hay tests `[TC-CLASSIFICATION-TAG-006]` ni `[TC-CLASSIFICATION-COUNTERPARTY-005]`.
  > Hecho (2026-10-04): `[TC-CLASSIFICATION-TAG-006]` (100.000000 USDT, `addedTagIds = [Trabajo]`) y `[TC-CLASSIFICATION-COUNTERPARTY-005]` (Hipermaxi → Fidalga, 300.00 USD, auditoría) en `classification-ledger.api.test.ts`.
- [x] 7.3 Test de totales por tag sin doble conteo; nombrado con TC-CLASSIFICATION-TAG-002
  > Verificado 2026-10-04 (pendiente, código): no hay test `[TC-CLASSIFICATION-TAG-002]`.
  > Hecho (2026-10-04): `[TC-CLASSIFICATION-TAG-002]` en `classification-ledger.api.test.ts`: 230.00 BOB por tag, filtro `tagId` devuelve la transacción una vez por tag y el gasto del mes pasa de 1,000.00 a 1,230.00 BOB. El tag repetido lo rechaza el contrato (`uniqueItems`) con `VALIDATION_FAILED`. También `[TC-CLASSIFICATION-KIND-002]` por API (ingreso rechazado sin transacción ni asiento; reembolso 500.00 → 450.00 BOB).

## 8. UI

- [x] 8.1 Pantalla de categorías (árbol grupo → categoría → subcategoría, icono, color, arrastrar para reordenar, archivar/desarchivar, filtro de archivadas, categorías de sistema marcadas como protegidas); verificar con tests de componentes
  - Nota (2026-10-03): solo lo mínimo para los selectores (`apps/web/src/ui/classification/ClassificationPage.tsx`, `/clasificacion`): árbol grupo → categoría → subcategoría, crear, archivar/desarchivar, filtro de archivadas, sistema protegidas y "aplicar catálogo sugerido". Falta: icono/color, arrastrar para reordenar y tests de componentes.
  - Nota (2026-10-04): `/clasificacion` con pestañas Categorías | Etiquetas | Contrapartes (`?vista=`). Categorías: árbol en el orden persistente (`sortOrder`), alta de grupo y de categoría/subcategoría con icono (iconos del catálogo con etiquetas i18n) y color (`<input type="color">` + "Sin color"), edición en línea (las de sistema solo icono/color/orden), reordenar con botones ↑/↓ accesibles por teclado (alternativa a arrastrar) y arrastrar entre hermanas (HTML5) vía `POST categories/reorder` con exactamente las hermanas activas; los selectores de categoría siguen el orden persistente de los grupos. Tests de componentes en `apps/web/src/ui/classification/classification.test.tsx`.
- [x] 8.2 Pantallas de tags y counterparties (alias, categoría por defecto) y selectores que excluyen archivados; creación inline de counterparty en el formulario de transacción con manejo de `NAME_TAKEN` → seleccionar la existente; verificar con tests de componentes
  - Nota (2026-10-03): hecho: tags y contrapartes (crear, archivar, desarchivar), selectores sin archivados y creación en línea de contraparte con `NAME_TAKEN` → selecciona la existente (E2E en `tests/e2e/specs/transactions.spec.ts`, TC-CLASSIFICATION-COUNTERPARTY-002). Falta: alias y categoría por defecto en la pantalla, tests de componentes.
  - Nota (2026-10-04): etiquetas con color y edición (renombrar/color); contrapartes con alias (separados por coma o línea, ≥ 3 caracteres, ≤ 20, sin repetidos) y categoría por defecto (selector sin archivadas), edición con `If-Match`; tests de componentes (alias, resumen, selector sin archivadas) y E2E.
- [x] 8.3 Paso opcional "cargar catálogo sugerido" en la creación del workspace y acción "aplicar catálogo sugerido"; textos en catálogos i18n `es` (y claves para `en`/`pt`)
  - Nota (2026-10-04): casilla "Cargar el catálogo sugerido de categorías" (marcada por defecto) en `/workspaces/nuevo` → `seedDefaultCategories`; acción "Aplicar catálogo sugerido" en Categorías con su explicación. i18n es/en/pt.

## 9. AUTOMATED TESTS y E2E

- [ ] 9.1 Completar los tests automatizados de todos los TC de este change y marcar `automation_status: automated`; verificar que el chequeo de trazabilidad no reporta TC sin test
  > Nota 2026-10-04: todos los TC del change están `automated` salvo TC-CLASSIFICATION-GROUP-001 (sin reporte por grupo en Phase 1).
- [x] 9.2 E2E (Playwright): crear workspace con catálogo, crear subcategoría, archivarla y comprobar que desaparece del selector pero sigue en el historial; crear counterparty inline; verificar en CI
  - Nota (2026-10-04): `tests/e2e/specs/classification.spec.ts`: workspace nuevo con catálogo por la UI, subcategoría "Fibra óptica" con icono y color, reordenada con el teclado (persiste tras recargar), gasto clasificado en ella, archivada → fuera del árbol y del selector de `/transacciones/nueva`, visible con "Mostrar archivadas" y en el detalle del gasto; contraparte con alias y categoría por defecto (resuelta por alias) y etiqueta. La creación inline de contraparte ya la cubre `transactions.spec.ts` (TC-CLASSIFICATION-COUNTERPARTY-002). Páginas nuevas en `a11y.spec.ts`.

## 10. DOCUMENTACIÓN y cierre

- [ ] 10.1 Actualizar docs/08 §5.5 (unique de nombre por padre, `category_name_i18n`, `system_code`, `icon`, `normalized_name` de tags), docs/10 §9.1 (nuevos códigos), docs/11 (`classification.CategoryArchived.v1`), docs/05 §2.5 (provisión síncrona) y docs/29 (catálogo inicial) según lo aprobado
- [ ] 10.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict --no-interactive`; verificar que pasa antes de archivar el change
