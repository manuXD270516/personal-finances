# @pf/rules — bounded context RULES

Reglas WHEN/THEN de clasificación automática (openspec `add-rule-engine`; capability `rules/rule-engine`;
FR-RULES-001..010).

| Capa | Contenido |
|---|---|
| `domain` | AR `Rule` (activa, inactiva, archivada; versión de la definición vs. versión de la fila); `parseDefinition`, condiciones (matriz operador × campo, monto exacto con moneda) y acciones (sin propiedades de monto, moneda, cuenta, fecha, tipo ni estado); `RegexGuard` (motor de tiempo lineal de `@pf/shared-kernel`); `CompiledRuleSet`/`evaluateRules` (evaluador puro: acumulativo, **primer escritor gana** por campo y por etiqueta, `stopProcessing`, omisiones con motivo, origen por campo). Solo `@pf/shared-kernel`. |
| `application` | `RulesService` (crear, actualizar con `If-Match`, activar, desactivar, archivar, reordenar; auditoría en la misma unidad de trabajo), `RulesQueries` (listado con estadísticas y «requiere atención», versiones, **`evaluate`** = `RuleEvaluationQuery`, vista previa, cobertura), `RuleDryRunService` (dry-run por keyset y aplicación por lotes). Dobles en `application/testing`. |
| `infrastructure` | `PgRuleRepository` (una consulta ordenada por la cadena de evaluación, versiones append-only), `ClassificationReferenceCatalog` (destinos por los contratos públicos de CLASSIFICATION). |
| `interface` | `RulesModule` + `RulesController` (`/rules*`; `DELETE` ⇒ 405), `createRulesRuntime`. |
| `contracts` | `RuleEvaluationQuery` (puerto público que consume Imports), DTOs, `RULES_AUDIT_POLICY`, `RULES_PORTABILITY_SECTIONS`. |

Esquema de BD: `apps/api/db/migrations/20261030100000_rules_schema.sql` (RLS forzada, `platform.workspace_scoped_table`) y
`20261030100100`–`20261030100300` (columnas e índices de `txn.*`). JSON Schema del DSL en `contracts/rules/`.
Decisiones en `openspec/changes/add-rule-engine/design.md`; owner en `docs/57-phase-6-consolidation-decisions.md`
(D333–D339). Runbook: [Crear y probar reglas](../../../docs/runbooks/crear-y-probar-reglas.md).

No tiene consumidores de eventos ni colas (presupuesto de conexiones, D249). Transactions no importa este paquete: define el
puerto `RuleSuggestionPort` y la composición de `apps/api` lo adapta a `RuleEvaluationQuery`.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios y de propiedades de dominio y aplicación (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorio, RLS y permisos contra PostgreSQL 18 (Testcontainers; requiere Docker) |
