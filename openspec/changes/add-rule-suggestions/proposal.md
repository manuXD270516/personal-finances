# Propuesta: add-rule-suggestions

## Why

El motor de reglas de Phase 6 (`add-rule-engine`, implementado; criterio de salida: ≥ 70 % de lo importado clasificado por reglas) deja en manos del usuario escribir cada regla. La señal para escribirlas ya existe en los datos: desde `add-rule-engine`, cada split guarda el origen de su categoría (`MANUAL`, `RULE`, `COUNTERPARTY_DEFAULT`, `SYSTEM_DEFAULT`, `UNKNOWN`). Cuando el usuario clasifica a mano tres veces la misma glosa en la misma categoría, o corrige lo que puso una regla, está describiendo una regla que todavía no existe. FR-RULES-011 (Could, Phase 7; US-232 en docs/25) pide "sugerir reglas a partir de recategorizaciones manuales repetidas (≥ 3 veces mismo patrón)", y docs/24 §5.7 lo incluye en el alcance de Phase 7. Sugerirlas con evidencia, con confianza y con vista previa, y crearlas solo cuando el usuario acepta, sube la cobertura de reglas sin aprendizaje automático (el core funciona sin ML) y sin decisiones silenciosas (D346: nada se auto-aprueba).

## What Changes

- **Detección de patrones** sobre la evidencia de clasificación manual de los últimos 180 días (configurable hasta 366, hasta 5 000 transacciones). Cuenta el origen `MANUAL` y el `UNKNOWN` anterior al motor (pregunta 1); solo transacciones de un split, no administradas por otro módulo, con categoría distinta de "sin categoría".
- **Dos tipos de patrón:**
  - descripción normalizada sin números, asteriscos ni palabras de un carácter (5 palabras como máximo; misma normalización que "crear regla desde una fila");
  - contraparte, que tiene preferencia cuando su evidencia contiene la de una descripción.
- **Umbrales:** apoyo ≥ 3 (FR-RULES-011) y **confianza** = apoyo ÷ total del patrón ≥ 0.8000, con 4 decimales HALF_EVEN y nivel "alta" o "media".
- **Cruce con las reglas existentes:**
  - no se sugiere lo que las reglas activas ya cubren;
  - si una regla clasifica distinto, la sugerencia informa el conflicto y propone una prioridad que la adelante.
- **Explicación:** evidencia, contraejemplos y conflictos.
- **Vista previa sin efectos:** usa el mismo evaluador y los mismos motivos de no aplicable que el dry-run. Informa cuántas transacciones completaría, cuántas coinciden con la categoría sugerida y cuántas no.
- **Aceptación explícita:** crea la regla por la vía normal (`createRule`, editable antes de guardar) con su origen registrado. No reclasifica nada; aplicar a la historia sigue siendo el dry-run con su aplicación.
- **Descartar** (no vuelve a aparecer) y **restaurar** (Could).
- **Nada en segundo plano:** las sugerencias se calculan solo cuando un usuario las pide. Sin jobs ni consumidores nuevos (D249).
- Portabilidad de las decisiones (aceptadas y descartadas) en el export.
- **Fuera de alcance:**
  - acciones "split por porcentajes" y "vincular a meta" de FR-RULES-005, diferidas por D335 (pregunta 4: se recomienda no hacerlas en Phase 7);
  - sugerir acciones distintas de la categoría (etiquetas, contraparte, renombrar);
  - reglas sobre transferencias y conversiones (D336);
  - clasificación por modelos (Phase 8, `forecast/*`);
  - avisos o notificaciones de sugerencias nuevas.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `rules/rule-engine`: 12 requirements ADDED (2 Must, 1 Should, 9 Could): sugerencia por repetición, evidencia, patrones, confianza, cobertura y conflictos, explicación, vista previa, aceptación, descarte, sin automatismo, permisos y auditoría, límites y rendimiento. La capability la crea `add-rule-engine` (implementado y sin archivar): este change se archiva después.
- `identity/workspace-portability`: 1 requirement ADDED (Must): decisiones de sugerencias en el export.

## Impact

**Specs impactadas:** `rules/rule-engine` (ADDED) e `identity/workspace-portability` (ADDED). Lee sin modificarlas `classification/categories`, `classification/counterparties`, `transactions/transaction-recording` (origen de la categoría), `audit/audit-trail` y `security/access-control`.

**Componentes/contextos impactados:**
- RULES (`@pf/rules`):
  - domain: DS `RuleProposalMiner` (puro: claves de patrón, agrupación, confianza, deduplicación y cobertura), VO `DescriptionKey`, `RuleProposal` y `ProposalFingerprint`;
  - application: `RuleProposalsService` (listar, probar, descartar y restaurar) y `RulesService.createRule` con `fromSuggestion`;
  - infrastructure: `PgRuleProposalDecisionRepository` y sección del export;
  - interface: rutas `rules/suggestions`.
- TRANSACTIONS (`@pf/transactions`): método aditivo `ClassificationSubjectsQuery.listEvidence` (evidencia manual más reciente, en una consulta).
- `apps/web`: pestaña "Sugerencias" en Reglas, con evidencia, vista previa, aceptar con el editor prellenado, descartar y restaurar. La normalización `ruleTextFromDescription` de la UI se alinea con `DescriptionKey` mediante vectores de prueba comunes.
- Los nombres de código usan `RuleProposal*` para no confundirse con el puerto existente `RuleSuggestionPort` de Transactions (la sugerencia de resultado en el alta manual).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo:
- operaciones nuevas `listRuleSuggestions` (`GET W/rules/suggestions`), `previewRuleSuggestion` (`POST W/rules/suggestions/preview`), `dismissRuleSuggestion` (`POST W/rules/suggestions/{suggestionId}/dismiss`) y `restoreRuleSuggestion` (`POST W/rules/suggestions/{suggestionId}/restore`);
- propiedad opcional `fromSuggestion` en `RuleInput` (entrada) y en `Rule` (respuesta);
- código nuevo `RULE_SUGGESTION_DECIDED` (409) en `ErrorCode`.

Detalle en design.md § Contratos.

**Tablas impactadas:** nueva `rules.rule_suggestion_decision` (RLS forzada, registro en `platform.workspace_scoped_table`); índice parcial nuevo sobre `txn.transaction_split` para la evidencia (`CONCURRENTLY`, migración aparte).

**Eventos impactados:** ninguno nuevo ni modificado. Aceptar no aplica reglas; la aplicación posterior usa el dry-run, que emite los eventos de la edición masiva como hoy.

**Migraciones requeridas:** expand, no destructivas: tabla nueva con RLS y grants (`pf_app` SELECT/INSERT/DELETE; `pf_worker` SELECT); índice parcial `CONCURRENTLY`; sección del export (versión menor del formato).

**Test cases:**
- AÑADIDOS: TC-RULES-SUGGEST-001..028 (28).
- MODIFICADOS: ninguno (TC-RULES-ENGINE-054 sigue igual; sus vectores se reutilizan en TC-RULES-SUGGEST-007).
- DEPRECADOS: ninguno.

**Impacto de regresión:** `createRule` acepta una propiedad opcional nueva; sin ella el comportamiento no cambia (TC-RULES-ENGINE-001..054 en verde). El método nuevo de `ClassificationSubjectsQuery` no altera `list` ni `byIds`. El evaluador gana un modo "cualquier disparador" solo para el cruce de cobertura; los demás llamadores no cambian.

**Riesgos introducidos:**
- RISK-016 (clasificación masiva incorrecta): mitigado con confianza mínima, vista previa, aceptación explícita y aplicación solo por dry-run.
- RISK-029 (costo del cálculo): acotado a 5 000 transacciones, cuota `costly` y benchmark.

**Invariantes afectadas:** ninguna financiera. Las reglas nunca cambian montos, moneda, cuenta ni fecha (requirement vigente de `rules/rule-engine`). INV-025 (aislamiento por workspace) e INV-029 (auditoría en la misma transacción). La confianza se redondea HALF_EVEN.
