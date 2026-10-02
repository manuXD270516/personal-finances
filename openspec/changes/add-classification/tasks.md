# Tareas

> Requiere `bootstrap-platform-foundation`, `add-workspace-identity` y `add-audit-trail` aplicados. Los cambios de contrato listados en design.md §Contratos deben estar consolidados en `contracts/` antes del grupo 5.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar las specs `classification/categories`, `classification/tags` y `classification/counterparties` con el owner y resolver las preguntas abiertas de design.md (OPENING_BALANCE, provisión síncrona); verificar con `openspec validate add-classification --strict`
- [ ] 1.2 Confirmar los TC MODIFICADOS (TC-CLASSIFICATION-ARCHIVE-001, -DELETE-001, -RECATEGORIZE-001) y los 24 AÑADIDOS en `tests/cases/classification/`; verificar que el chequeo del catálogo de trazabilidad los acepta y que todo requirement Must tiene ≥ 1 TC
- [ ] 1.3 Redactar los TC de los requirements Should (desarchivar categoría/tag/counterparty, orden persistente, grupos, grupo no vacío, sugerencia de categoría); verificar con el chequeo del catálogo

## 2. DOMAIN — categorías y grupos (TDD)

- [ ] 2.1 Test-first: `NormalizedText` (mayúsculas, acentos, espacios) con tests unitarios y de propiedades; verificar que pasan
- [ ] 2.2 Test-first: AR `CategoryGroup` y `Category` — tipo inmutable, profundidad ≤ 2 (`CATEGORY_DEPTH_EXCEEDED`), herencia de grupo/tipo, `CATEGORY_KIND_MISMATCH`, archivado en cascada, desarchivado con padre archivado; tests de dominio nombrados con TC-CLASSIFICATION-HIERARCHY-001, -KIND-001, -ARCHIVE-003
- [ ] 2.3 Test-first: `SystemCategoryPolicy` y `SystemCategoryCatalog` (11 códigos, tipos, prohibiciones `SYSTEM_CATEGORY_IMMUTABLE`); tests nombrados con TC-CLASSIFICATION-SYSTEM-001, -SYSTEM-002
- [ ] 2.4 Test-first: invariante INV-019 como test de propiedades (∀ secuencia crear/asignar/archivar/desarchivar: toda referencia resuelve a una categoría existente); verificar con TC-CLASSIFICATION-DELETE-001

## 3. DOMAIN — tags y counterparties (TDD)

- [ ] 3.1 Test-first: AR `Tag` (nombre normalizado único, archivado, desarchivado); tests nombrados con TC-CLASSIFICATION-TAG-001, -TAG-003
- [ ] 3.2 Test-first: AR `Counterparty` y VO `Alias` (mínimo 3 caracteres, únicos), `CounterpartyMatcher` (subcadena normalizada, desempate por alias más largo, ignora archivadas); tests nombrados con TC-CLASSIFICATION-COUNTERPARTY-001, -ALIAS-001, -ALIAS-002

## 4. APPLICATION

- [ ] 4.1 Casos de uso de categorías/grupos (crear, actualizar, mover, archivar, desarchivar, reordenar) con `AuditPort` y outbox de `classification.CategoryArchived.v1`; tests de aplicación con fakes nombrados con TC-CLASSIFICATION-CATEGORY-001, -RENAME-001, -ARCHIVE-001
- [ ] 4.2 `ProvisionSystemCategories` (idempotente) cableado en la composición de `CreateWorkspace`; verificar que un workspace nuevo tiene exactamente las 11 categorías de sistema (TC-CLASSIFICATION-SYSTEM-001)
- [ ] 4.3 `ApplyDefaultCategoryCatalog` + archivo de datos `default-catalog.es-BO.v1.json` con el catálogo de design.md §7; verificar idempotencia y conteos con TC-CLASSIFICATION-SEED-001
- [ ] 4.4 Casos de uso de tags y counterparties (incl. creación inline con `existingId` en `NAME_TAKEN`) y queries `ResolveCounterparty`, `GetCategorySuggestion` (puerto `LastCategoryUsedQueryPort`); tests nombrados con TC-CLASSIFICATION-COUNTERPARTY-002, -TAG-005
- [ ] 4.5 Query pública `ValidateClassification` (archivados, tipo, existencia) expuesta en `contracts` del paquete; tests nombrados con TC-CLASSIFICATION-ARCHIVE-002, -KIND-002, -TAG-004, -COUNTERPARTY-004

## 5. INFRASTRUCTURE

- [ ] 5.1 Migración *expand* del schema `classification` (tablas, índices parciales, CHECKs, triggers de tipo/profundidad/sistema, RLS `ENABLE/FORCE`, grants sin `DELETE`) y migración de nombres i18n; verificar con test de migración sobre PG vacío y test de RLS/grants (Testcontainers)
- [ ] 5.2 Repositorios PostgreSQL con optimistic locking y adaptador de outbox; tests de integración de repositorio nombrados con TC-CLASSIFICATION-ARCHIVE-001, -TAG-003, -COUNTERPARTY-003
- [ ] 5.3 Adaptador `LastCategoryUsedQueryPort` contra el `contracts` de Transactions (stub hasta `add-transaction-recording`); verificar con test de integración
- [ ] 5.4 Schema de evento `classification.CategoryArchived.v1` y test de contrato del productor; verificar que el payload valida contra el schema

## 6. API

- [ ] 6.1 Controladores REST de categorías, grupos, tags y counterparties según el contrato consolidado (incl. unarchive, reorder, apply-default-catalog, resolve, category-suggestion; 405 para `DELETE`); tests de API nombrados con TC-CLASSIFICATION-DELETE-001, -SYSTEM-002, -SYSTEM-003
- [ ] 6.2 Resolución de nombres de categorías de sistema por locale del usuario; verificar con TC-CLASSIFICATION-SYSTEM-003
- [ ] 6.3 Tests de contrato OpenAPI (respuestas validan contra el schema; códigos de error del catálogo) y autorización por rol (`VIEWER` no escribe)

## 7. Integración con Transactions (cuando exista `add-transaction-recording`)

- [ ] 7.1 Test de integración INV-033: recategorizar un gasto de 150.00 BOB no cambia asientos ni saldos; nombrado con TC-CLASSIFICATION-RECATEGORIZE-001
- [ ] 7.2 Tests de integración de etiquetado y cambio de counterparty sin efecto en el ledger; nombrados con TC-CLASSIFICATION-TAG-006 y TC-CLASSIFICATION-COUNTERPARTY-005
- [ ] 7.3 Test de totales por tag sin doble conteo; nombrado con TC-CLASSIFICATION-TAG-002

## 8. UI

- [ ] 8.1 Pantalla de categorías (árbol grupo → categoría → subcategoría, icono, color, arrastrar para reordenar, archivar/desarchivar, filtro de archivadas, categorías de sistema marcadas como protegidas); verificar con tests de componentes
- [ ] 8.2 Pantallas de tags y counterparties (alias, categoría por defecto) y selectores que excluyen archivados; creación inline de counterparty en el formulario de transacción con manejo de `NAME_TAKEN` → seleccionar la existente; verificar con tests de componentes
- [ ] 8.3 Paso opcional "cargar catálogo sugerido" en la creación del workspace y acción "aplicar catálogo sugerido"; textos en catálogos i18n `es` (y claves para `en`/`pt`)

## 9. AUTOMATED TESTS y E2E

- [ ] 9.1 Completar los tests automatizados de todos los TC de este change y marcar `automation_status: automated`; verificar que el chequeo de trazabilidad no reporta TC sin test
- [ ] 9.2 E2E (Playwright): crear workspace con catálogo, crear subcategoría, archivarla y comprobar que desaparece del selector pero sigue en el historial; crear counterparty inline; verificar en CI

## 10. DOCUMENTACIÓN y cierre

- [ ] 10.1 Actualizar docs/08 §5.5 (unique de nombre por padre, `category_name_i18n`, `system_code`, `icon`, `normalized_name` de tags), docs/10 §9.1 (nuevos códigos), docs/11 (`classification.CategoryArchived.v1`), docs/05 §2.5 (provisión síncrona) y docs/29 (catálogo inicial) según lo aprobado
- [ ] 10.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict --no-interactive`; verificar que pasa antes de archivar el change
