# Diseño: add-rule-engine

## Contexto

Phase 6 (docs/24 §5.6) pide reducir la captura manual con imports confiables y clasificación automática. Su criterio de salida exige que, al importar 3 meses de extractos reales del owner, **al menos el 70 % de las transacciones quede clasificado por reglas**. Hoy:

- **Classification** sugiere una categoría por contraparte (`GetCategorySuggestion`: categoría por defecto de la contraparte o la última usada, `classification/counterparties`) y reconoce contrapartes por alias en descripciones (`ResolveCounterparty`, `CounterpartyMatcher`). Nunca asigna: solo sugiere al llenar el formulario.
- **Transactions** registra cada split con `category_id` obligatorio (la categoría de sistema "sin categoría" cuando no hay otra, D9), contraparte en la transacción y en el split, etiquetas (`txn.split_tag`) y campos personalizados. La edición masiva (`transactions/bulk-edit`) cambia categoría, etiquetas, contraparte, notas y campos personalizados de hasta 500 transacciones en forma atómica, con versión, periodos cerrados no aplicables y un `bulkOperationId` común en la auditoría.
- **Imports** (Phase 3, `add-basic-csv-import`) crea gastos e ingresos "sin categoría" con `RecordImportedTransactions` (`ImportedTransactionsCommand.recordBatch`), sin reglas. El pipeline completo de Phase 6 lo redacta en paralelo `add-import-pipeline` (FR-IMPORTS-008: reglas en la vista previa).
- **RULES** no existe en el código. docs/05 §2.13 lo define como contexto de soporte (`@pf/rules`, schema `rules`), docs/08 §5.13 esboza `rules.rule` (condiciones y acciones en JSONB con JSON Schema versionado) y `rules.rule_execution`, y ARCHITECTURE §7 prevé la evaluación síncrona sin efectos desde Imports y una aplicación asíncrona posterior.

FR cubiertos: FR-RULES-001..010 (FR-RULES-011, sugerir reglas a partir de recategorizaciones, es Phase 7). FR-IMPORTS-008 se cubre del lado de las reglas; la vista previa y el staging son de `add-import-pipeline`.

## Objetivos / No objetivos

**Objetivos**

- Contexto RULES con reglas WHEN/THEN versionadas, prioridad determinista, vista previa, dry-run y aplicación auditada.
- Un único evaluador puro que sirva a los tres disparadores (importación, creación manual, ejecución retroactiva) con el mismo resultado para la misma entrada.
- Origen de la clasificación por split (regla y versión por campo) y una medición exacta y reproducible del criterio de salida del 70 %.
- Cero consumidores nuevos de eventos (presupuesto de conexiones de D249: 64 de 67 útiles).

**No objetivos**

- Sugerir reglas a partir de recategorizaciones (FR-RULES-011, Phase 7).
- Acciones "split por porcentajes" y "vincular a meta" de FR-RULES-005 (pregunta 3).
- Reglas sobre transferencias y conversiones, y la acción "marcar como transferencia" de docs/13 §4.1 etapa 6 (pregunta 4).
- Aprendizaje automático o IA (el core funciona sin ML, `openspec/config.yaml`).
- Staging, vista previa y persistencia del import: son de `add-import-pipeline`; aquí solo se fija el contrato que ese change consume.

## Decisiones

### 1. Contexto nuevo RULES (`@pf/rules`, schema `rules`)

- **Elegida:** contexto propio, como fijan docs/05 §2.13 y ARCHITECTURE §14 (`rules/rule-engine`). Capas: `domain` (AR `Rule`, VO `Condition`/`Action`/`RuleDefinition`, DS `RuleEvaluator`, `RegexGuard`), `application` (`RulesService`, `RulesQueries`, `RuleDryRunService`), `infrastructure` (`PgRuleRepository`, JSON Schema del DSL), `interface` (controller), `contracts` (`RuleEvaluationQuery` y DTO).
- **Alternativas:** (a) dentro de Classification: mezclaría catálogo y automatización, y Classification no conoce transacciones; (b) dentro de Transactions: crece un contexto ya grande y acopla el registro al DSL. Ambas contradicen docs/05.
- Dependencias: RULES lee `@pf/classification/contracts` (validar referencias, catálogo activo) y `@pf/transactions/contracts` (sujetos del dry-run, aplicación y cobertura). Imports lee `@pf/rules/contracts`. Transactions **no** importa RULES: define un puerto propio (decisión 5). `pnpm arch:check` sin ciclos.

### 2. Semántica de evaluación: acumulativa, "primer escritor gana" por campo, con `stopProcessing`

| Opción | Cómo funciona | Pros | Contras |
|---|---|---|---|
| (a) Primera coincidencia | Solo la primera regla que coincide aplica sus acciones | Muy predecible | Para "categoría por comercio + etiqueta por cuenta" hay que duplicar reglas (combinatoria); no usa `stopProcessing` |
| (b) Acumulativa, última gana | Todas aplican en orden; una posterior sobrescribe | Familiar (Firefly III) | Contradice FR-RULES-006: "gana la de mayor prioridad" |
| **(c) Acumulativa, primer escritor gana (elegida)** | Todas las que coinciden aportan; en cada campo de valor único y en cada etiqueta gana la de menor número de prioridad; `stopProcessing` corta la cadena | Cumple FR-RULES-006 literal, compone reglas ortogonales (categoría + etiqueta + revisión) sin duplicar, el origen por campo es exacto | Hay que mostrar el origen por campo (ya lo exige FR-RULES-010) |

Detalles: orden total `(priority ASC, created_at ASC, id ASC)`. Una acción **omitida** (destino archivado, tipo de categoría incompatible, más de un split, campo no vacío en modo "completar") **no escribe** el campo, así que una regla posterior puede fijarlo. Etiquetas: cada etiqueta es su propio "campo" (la primera regla que la agrega o la quita decide). `appendNote` acumula en orden de prioridad (no es de valor único). La propiedad "misma entrada ⇒ mismo resultado con cualquier orden de carga" se prueba con PBT (TC-RULES-ENGINE-020).

### 3. Evaluador puro y un puerto set-based de solo lectura

- `RuleEvaluator.evaluate(rules, subjects, trigger, mode)` es una función pura del dominio: compila cada regla una vez (texto normalizado, `Decimal` de montos, regex del motor lineal) y normaliza la descripción de cada sujeto una sola vez.
- `RuleEvaluationQuery.evaluate` (contrato público) carga las reglas activas del disparador con **una** consulta y el conjunto de ids activos de Classification con otra, y evalúa en memoria hasta 5 000 sujetos por llamada. Sin efectos, sin auditoría, en la unidad de trabajo del llamador.
- **Alternativa descartada:** aplicación asíncrona tras `transactions.TransactionCreated` (docs/05, ARCHITECTURE §7). Motivos: (1) un consumidor nuevo suma conexiones a un presupuesto de 64 de 67 útiles (D249, docs/38 §4); (2) aplicaría reglas **después** de que el usuario aprobó la vista previa, cambiando en silencio lo aprobado; (3) duplica la escritura (crear y luego recategorizar = dos revisiones, dos auditorías y más eventos para un import de 5 000 filas, D152). La clasificación viaja ya decidida en la creación. ARCHITECTURE §7 debe actualizarse (Cambios a docs compartidos).

### 4. Importación: orden de la etapa y contrato con `add-import-pipeline`

Orden por fila en la vista previa (coordinado con `add-import-pipeline`):

1. Normalizar (pipeline).
2. Reconocer contraparte por alias (`ResolveCounterparty`, Classification); el resultado entra al sujeto como `counterpartyOrigin = ALIAS`.
3. **Reglas** (`RuleEvaluationQuery.evaluate`, `trigger = IMPORT`, `mode = FILL_EMPTY`): una contraparte de origen `ALIAS` es reemplazable por una acción de regla; las demás no.
4. Si ninguna regla fijó categoría: categoría por defecto de la contraparte final (`GetCategorySuggestion` con fuente `DEFAULT`, sin "última usada") ⇒ origen `COUNTERPARTY_DEFAULT`.
5. Si nada: "sin categoría" ⇒ `SYSTEM_DEFAULT`.

El staging guarda la propuesta con `ruleId`/`ruleVersion` por campo. Al aprobar, la fila persiste **lo mostrado** (decisión de la spec: una regla editada después no cambia lo aprobado; la vista previa ofrece "reevaluar reglas", que vuelve a llamar al puerto). Una edición del usuario en la fila pone el origen de ese campo en `MANUAL`. `RecordImportedTransactions` recibe la clasificación con su origen (contrato abajo).

**Excluir del import** (acción Should) produce en la fila la decisión propuesta "excluir" con su regla; el usuario puede revertirla en la vista previa.

### 5. Creación manual: puerto de Transactions con adaptador en la composición

- Transactions define `RuleSuggestionPort` en `application/ports` (no importa `@pf/rules`); `apps/api` lo implementa con `RuleEvaluationQuery` (mismo patrón que `ClosedPeriodsPort` de Imports). `createTransaction` lo llama **dentro** de la unidad de trabajo, solo para `INCOME`, `EXPENSE` y `REFUND` y si `applyRules` no es `false`, con `trigger = MANUAL_CREATE` y `mode = FILL_EMPTY` (la categoría explícita, la contraparte explícita y los campos con valor son del usuario).
- Costo: una consulta indexada por `(workspace_id) WHERE enabled AND archived_at IS NULL AND 'MANUAL_CREATE' = ANY(triggers)` más la evaluación en memoria de un sujeto. Presupuesto: +20 ms al p95 de NFR-PERF-003 (150 ms) con 200 reglas.
- **Alternativas:** (a) sugerencia solo en la UI antes de enviar (no cubre la API ni el registro rápido); (b) consumidor asíncrono (decisión 3).
- Recurrentes, préstamos, metas y tarjetas no pasan por este puerto: crean transacciones con categoría propia (`source` distinto de `MANUAL`).

### 6. Origen de la clasificación en el split (en lugar de `rules.rule_execution`)

- `txn.transaction_split` gana `category_origin`, `category_rule_id`, `category_rule_version` y `rule_refs` (JSONB con `{field, ruleId, ruleVersion}` para etiquetas, contraparte, campos personalizados, descripción y nota). `txn.transaction` gana la marca de revisión.
- Es la fuente de verdad de "qué regla clasificó cada transacción" (FR-RULES-010) y de la cobertura. La auditoría de creación y de cambio lleva los `ruleRefs` en sus detalles (historia).
- **Alternativa descartada:** `rules.rule_execution` de docs/08 §5.13 (una fila por aplicación). Para un import de 5 000 filas serían 5 000 inserts más en el camino crítico de D152 (persistencia ≤ 20 s), escritos desde la unidad de trabajo de Transactions en un schema ajeno; y el estado actual (para la cobertura) igual habría que derivarlo de la transacción. Los dry-run no se persisten (son efímeros). docs/08 §5.13 se actualiza (Cambios a docs compartidos).

### 7. Versionado de reglas

- `rules.rule` guarda el estado vigente y `version`. Cada cambio de definición (condiciones, acciones, `match_mode`, `triggers`, `stop_processing`) inserta una fila inmutable en `rules.rule_version` con la instantánea y sube `version`, en la misma unidad de trabajo que la auditoría. Nombre, descripción, prioridad y estado se auditan sin versión (no cambian qué hace la regla; la prioridad sí cambia el orden, y por eso queda en la auditoría con valor anterior y nuevo).
- Archivar en lugar de borrar (`DELETE` ⇒ `405`, como categorías, D7): las referencias desde splits siguen resolviéndose.

### 8. DSL en JSONB con JSON Schema versionado

- `conditions` (árbol de un nivel: `{ match: ALL|ANY, items: [Condition | {match, items: [Condition]}] }`) y `actions` (arreglo) en JSONB, validados por `contracts/rules/conditions.v1.schema.json` y `contracts/rules/actions.v1.schema.json` y por el dominio; `schema_version = 1` (docs/08 §5.13).
- `Condition = { field, operator, value?, currency? , fieldId? }`. Campos: `DESCRIPTION`, `COUNTERPARTY`, `AMOUNT` (exige `currency`; `value` y `valueTo` como texto decimal exacto, escala de la moneda), `CURRENCY`, `ACCOUNT`, `KIND` (`INCOME|EXPENSE|REFUND`), `DATE`, `WEEKDAY` (1–7, ISO), `DAY_OF_MONTH` (1–31), `CATEGORY`, `TAG`, `EXTERNAL_SOURCE` (`MANUAL`, `IMPORT`, `imports.csv-row`…), `CUSTOM_FIELD` (`fieldId`).
- `Action = { type: SET_CATEGORY|ADD_TAG|REMOVE_TAG|SET_COUNTERPARTY|SET_CUSTOM_FIELD|MARK_FOR_REVIEW|SET_DESCRIPTION|APPEND_NOTE|EXCLUDE_FROM_IMPORT, ... }`. El esquema no tiene propiedades para monto, moneda, cuenta, fecha, tipo ni estado (`additionalProperties: false`).
- Matriz operador × tipo de campo validada al guardar (`VALIDATION_FAILED` con puntero JSON).
- La fecha de la transacción se evalúa como fecha de negocio (ya en la zona del workspace); `WEEKDAY` y `DAY_OF_MONTH` se derivan de ella sin conversión de zona.

### 9. Texto y expresiones regulares

- `normalizeText` (NFD sin diacríticos, minúsculas, espacios colapsados) pasa de `classification/domain` a `@pf/shared-kernel` (`text/normalize`); Classification lo re-exporta sin cambio de comportamiento. RULES y Classification comparan igual.
- `matches_regex`: motor de **tiempo lineal** (port JS de RE2; licencia a verificar contra NFR-COMP-003 en la tarea 2.4, MIT o BSD esperada); patrón ≤ 200 caracteres, texto ≤ 500, sin referencias hacia atrás ni lookaround (`RULE_INVALID_REGEX`). Sin timeouts por reloj (no son deterministas en CI): la garantía es estructural. Bandera de mayúsculas implícita; el texto se normaliza antes de evaluar.

### 10. Dry-run y aplicación

- `POST W/rules/dry-run` (VIEWER puede ejecutarlo; cuota `costly`): lee sujetos con `ClassificationSubjectsQuery.list` (keyset, ≤ 5 000, solo `INCOME`/`EXPENSE`/`REFUND` no anuladas) y evalúa con `trigger = RETROACTIVE`. Devuelve los ítems con cambio y un `token` = SHA-256 de `(ruleIds y versiones, transactionId y version de cada ítem con cambio, mode)`.
- `POST W/rules/dry-run/apply` (EDITOR, `Idempotency-Key`, cuota `costly`): recibe `token`, la definición del dry-run y hasta 500 `transactionIds`; RULES recalcula el diff de esos ítems y compara el token parcial; si difiere ⇒ `409 RULE_DRY_RUN_STALE`. Aplica con `RuleClassificationCommand.applyBatch` de Transactions, que reutiliza el dominio de la edición masiva (atómico, versión por ítem, periodos cerrados no aplicables con `PERIOD_CLOSED` en `notApplicable[]`, auditoría con `bulkOperationId` y origen `RULE`). Más de 500: la UI aplica por páginas.
- **Alternativa:** dry-run asíncrono como operación 202. Innecesario con el tope de 5 000 y el presupuesto de 3 s; se reconsidera si el owner pide rangos mayores.

### 11. Cobertura y criterio de salida (≥ 70 %)

**Definición exacta** (spec "Cobertura de clasificación por reglas"):

- Universo: transacciones `INCOME`, `EXPENSE`, `REFUND` con `source = IMPORT`, no `VOIDED`, con `transaction_date` en el rango (o `import_job_id` dado). Se excluyen transferencias y conversiones (no llevan categoría).
- Clasificada por reglas: su único split (o todos, si hay varios) tiene `category_origin = RULE` **hoy**. Una corrección manual posterior la saca del numerador (mide reglas útiles, no solo reglas que dispararon).
- Cociente = reglas ÷ total, 4 decimales HALF_EVEN, junto a `target = 0.7000`. Desglose: `COUNTERPARTY_DEFAULT`, `MANUAL`, `SYSTEM_DEFAULT`, `UNKNOWN` (anteriores al change).
- Cálculo: `ClassificationCoverageQuery.coverage` en Transactions (una consulta agregada sobre `transaction_split` vigente, índice parcial por `category_rule_id`); RULES agrega nombres y estado de cada regla.

**Cómo se verifica el criterio de salida:** el owner importa sus 3 meses (bancos de docs/38 §2, change 41) con sus reglas, consulta `GET W/rules/coverage?from=…&to=…` y registra en la tarea 7.5 la cifra (`ruleCoverage ≥ 0.7000`), sin montos ni descripciones (TC-RULES-ENGINE-047, evidencia del owner como TC-PLANNING-EXIT-001). La cobertura de cada import aparece también al terminar el import (resumen de `add-import-pipeline`).

### 12. Marca de revisión

- Columnas `review_status` (`PENDING` o nulo), `review_rule_id`, `review_rule_version`, `review_marked_at` en `txn.transaction`. Quitarla: `PATCH W/transactions/{id}` con `needsReview: false` (`If-Match`), auditado; sin revisión de la transacción ni asiento. Filtro `needsReview=true` en `listTransactions`.
- La marca hecha por un usuario (sin regla) se admite con `needsReview: true`; el motivo queda `USER`.

### 13. Multi-split, tipos y transacciones especiales

- Acciones de split (categoría, etiquetas, campos personalizados) solo sobre transacciones de **un** split; con más ⇒ omitida (`MULTI_SPLIT`), como `BULK_EDIT_NOT_APPLICABLE` en la edición masiva.
- Transacciones gestionadas por otro módulo (`TRANSACTION_MANAGED_EXTERNALLY`: préstamos, metas) y conciliadas: el dry-run las marca no aplicables con ese código; la creación manual no las toca.

### Capas afectadas

| Contexto | Capa | Cambio |
|---|---|---|
| RULES (nuevo) | domain, application, infrastructure, interface, contracts | Todo el contexto |
| Transactions | domain | Origen de clasificación en `Split`; marca de revisión en `Transaction`; aplicación de reglas reutilizando el dominio de la edición masiva |
| Transactions | application | `RuleSuggestionPort`; `createTransaction` con `applyRules`; `recordBatch` acepta clasificación; `RuleClassificationCommand`, `ClassificationSubjectsQuery`, `ClassificationCoverageQuery` |
| Transactions | infrastructure | Columnas nuevas; consultas de sujetos y cobertura |
| Classification | domain | `normalizeText` re-exportado desde `@pf/shared-kernel` |
| Imports | application | Llama a `RuleEvaluationQuery` en la vista previa (lo implementa `add-import-pipeline`) |
| `apps/api` | composición | Adaptador `RuleSuggestionPort` → `RuleEvaluationQuery`; módulo RULES |
| `apps/web` | UI | Pantalla de reglas, editor, vista previa, dry-run, cobertura; origen y marca en el detalle y el listado |

## Contratos

### OpenAPI (aditivo, tag Rules, `x-openspec-capability: rules/rule-engine`)

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listRules` | `GET W/rules` | VIEWER | Filtros `enabled`, `trigger`, `includeArchived`, `needsAttention`; orden por prioridad; cada `Rule` con `stats { classifiedTransactions, lastAppliedAt, unusedFor90Days }` |
| `createRule` | `POST W/rules` | EDITOR | `Idempotency-Key`; 422 `VALIDATION_FAILED`, `RULE_INVALID_REGEX`, `RULE_LIMIT_EXCEEDED`, `REFERENCE_NOT_FOUND`; 409 `NAME_TAKEN`, `CATEGORY_ARCHIVED`, `TAG_ARCHIVED`, `COUNTERPARTY_ARCHIVED`, `CUSTOM_FIELD_ARCHIVED` |
| `getRule` | `GET W/rules/{ruleId}` | VIEWER | `ETag` = versión de fila |
| `updateRule` | `PUT W/rules/{ruleId}` | EDITOR | `If-Match`; crea versión si cambia la definición; 412 `PRECONDITION_FAILED` |
| `enableRule`, `disableRule`, `archiveRule` | `POST W/rules/{ruleId}/enable\|disable\|archive` | EDITOR | `If-Match`; `DELETE W/rules/{ruleId}` ⇒ 405 `METHOD_NOT_ALLOWED` |
| `listRuleVersions` | `GET W/rules/{ruleId}/versions` | VIEWER | Instantáneas inmutables |
| `reorderRules` | `PUT W/rules/order` | EDITOR | `{ ruleIds[] }` completo de las no archivadas; asigna prioridades 10, 20, 30…; auditado; sin versión |
| `previewRule` | `POST W/rules/preview` | VIEWER | `{ ruleId \| definition, subject: { transactionId } \| { sample } }` ⇒ `{ matched, conditions[{ path, met, actual }], actions[], skipped[{ action, reason }] }`; sin efectos |
| `dryRunRules` | `POST W/rules/dry-run` | VIEWER | `x-rate-limit: costly`; `{ ruleIds?, from, to, accountIds?, mode: FILL_EMPTY\|OVERWRITE }` ⇒ `{ scanned, changed, truncated, token, items[{ transactionId, version, applicable, reasons[], changes[{ field, before, after, ruleId, ruleVersion }] }] }` |
| `applyRuleDryRun` | `POST W/rules/dry-run/apply` | EDITOR | `Idempotency-Key`, `x-rate-limit: costly`; `{ token, definition, transactionIds[≤500] }` ⇒ `{ bulkOperationId, applied, notApplicable[] }`; 409 `RULE_DRY_RUN_STALE` |
| `getRuleCoverage` | `GET W/rules/coverage` | VIEWER | `from`, `to` o `importJobId` ⇒ `{ total, byOrigin { RULE, COUNTERPARTY_DEFAULT, MANUAL, SYSTEM_DEFAULT, UNKNOWN }, ruleCoverage: "0.7400", target: "0.7000", byRule[{ ruleId, name, version, archived, count }] }` |

Transactions (aditivo): `TransactionInput` gana `applyRules?: boolean` (por defecto `true`); `Transaction` gana `needsReview`, `review { reason: RULE\|USER, ruleId?, ruleVersion?, markedAt }`; `Split` gana `categoryOrigin` (`x-extensible-enum`: `MANUAL`, `RULE`, `COUNTERPARTY_DEFAULT`, `SYSTEM_DEFAULT`, `UNKNOWN`) y `ruleRefs[{ field, ruleId, ruleVersion, ruleName }]`; `TransactionPatch` gana `needsReview: boolean`; `listTransactions` gana el filtro `needsReview`.

Códigos nuevos en `ErrorCode` (`x-extensible-enum`, con mensajes es/en/pt): `RULE_INVALID_REGEX` (422), `RULE_LIMIT_EXCEEDED` (422), `RULE_DRY_RUN_STALE` (409). Motivos de omisión (no HTTP, enum abierto `RuleSkipReason`): `RULE_ACTION_TARGET_ARCHIVED`, `CATEGORY_KIND_MISMATCH`, `MULTI_SPLIT`, `NOT_EMPTY`, `TRANSACTION_MANAGED_EXTERNALLY`, `TRANSACTION_RECONCILED`, `PERIOD_CLOSED`. `pnpm contract:breaking` limpio.

### Contrato público de RULES (`@pf/rules/contracts`) — **puerto que consume `add-import-pipeline`**

```ts
export type RuleTriggerDto = 'IMPORT' | 'MANUAL_CREATE' | 'RETROACTIVE';
export type RuleEvaluationModeDto = 'FILL_EMPTY' | 'OVERWRITE';

export interface RuleSubjectDto {
  readonly ref: string;                       // id de la fila de staging o de la transacción
  readonly kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly accountId: string;
  readonly date: string;                      // YYYY-MM-DD (fecha de negocio)
  readonly amount: { readonly amount: string; readonly currency: string }; // positivo, escala de la moneda
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly counterpartyOrigin: 'USER' | 'ALIAS' | null; // ALIAS es reemplazable por una regla
  readonly categoryId: string | null;         // null ⇒ "sin categoría"
  readonly tagIds: readonly string[];
  readonly externalSource: string | null;     // `source` y namespace de la referencia externa
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly splitCount: number;
}

export interface RuleOriginDto { readonly ruleId: string; readonly ruleVersion: number }

export interface RuleOutcomeDto {
  readonly ref: string;
  readonly category: { readonly categoryId: string; readonly origin: RuleOriginDto } | null;
  readonly counterparty: { readonly counterpartyId: string; readonly origin: RuleOriginDto } | null;
  readonly addTags: readonly { readonly tagId: string; readonly origin: RuleOriginDto }[];
  readonly removeTags: readonly { readonly tagId: string; readonly origin: RuleOriginDto }[];
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean; readonly origin: RuleOriginDto }[];
  readonly description: { readonly text: string; readonly origin: RuleOriginDto } | null;
  readonly appendNotes: readonly { readonly text: string; readonly origin: RuleOriginDto }[];
  readonly markForReview: RuleOriginDto | null;
  readonly exclude: RuleOriginDto | null;     // solo con trigger IMPORT
  readonly matched: readonly RuleOriginDto[];
  readonly skipped: readonly { readonly origin: RuleOriginDto; readonly action: string; readonly reason: string }[];
}

/** Evaluación sin efectos (en la unidad de trabajo del llamador). ≤ 5 000 sujetos por llamada. */
export interface RuleEvaluationQuery {
  evaluate(input: {
    readonly workspaceId: string;
    readonly trigger: RuleTriggerDto;
    readonly mode: RuleEvaluationModeDto;
    readonly subjects: readonly RuleSubjectDto[];
  }): Promise<readonly RuleOutcomeDto[]>;
}
export const RULE_EVALUATION_QUERY = Symbol.for('pf.rules.RuleEvaluationQuery');
```

### Contratos públicos nuevos o ampliados de Transactions (aditivos)

- `ImportedTransactionRowDto` gana `classification?: ImportedClassificationDto` (si falta, el comportamiento de Phase 3: "sin categoría" con origen `SYSTEM_DEFAULT`):

  ```ts
  export interface ImportedClassificationDto {
    readonly categoryId: string | null;
    readonly categoryOrigin: 'RULE' | 'COUNTERPARTY_DEFAULT' | 'MANUAL' | 'SYSTEM_DEFAULT';
    readonly counterpartyId: string | null;
    readonly tagIds: readonly string[];
    readonly customFields: readonly CustomFieldValueInputDto[];
    readonly description?: string;            // reemplazo visible; el texto original queda en el staging
    readonly notes?: string;
    readonly needsReview: { readonly ruleId: string; readonly ruleVersion: number } | null;
    readonly ruleRefs: readonly { readonly field: string; readonly ruleId: string; readonly ruleVersion: number }[];
  }
  ```

  La ruta masiva de `RecordImportedTransactions` (D152) la redacta `add-bulk-imported-transactions` y la amplía `add-import-pipeline`; este campo es parte de su entrada (dependencia en § Dependencias). Valida referencias con `ClassificationValidator` una vez por lote (set-based).
- `RuleClassificationCommand.applyBatch({ workspaceId, actorUserId, operationId, items[{ transactionId, expectedVersion, changes, ruleRefs }] })` ⇒ `{ applied[], notApplicable[{ transactionId, reason }] }`; lanza `CONCURRENCY_CONFLICT` si una versión no coincide (RULES lo traduce a `RULE_DRY_RUN_STALE`).
- `ClassificationSubjectsQuery.list({ workspaceId, from, to, accountIds?, limit ≤ 5000, after? })` ⇒ sujetos (`RuleSubjectDto` + `transactionId`, `version`, `status`, `managedBy`).
- `ClassificationCoverageQuery.coverage({ workspaceId, from?, to?, importJobId? })` ⇒ `{ total, byOrigin, byRule[{ ruleId, ruleVersion?, count, lastAppliedAt }] }`.
- Puerto interno `RuleSuggestionPort` (`application/ports`): `suggest(subject) ⇒ RuleOutcomeDto | null`.

### Eventos

Sin eventos nuevos ni consumidores nuevos. La aplicación del dry-run emite los eventos que ya emite la edición masiva (`transactions.TransactionUpdated.v1`/`TransactionCategorized.v1`), sin cambio de esquema. El registro manual y el import emiten `TransactionCreated.v1` como hoy.

## Modelo de datos (expand-only)

| Tabla | Columnas y restricciones | RLS y grants |
|---|---|---|
| `rules.rule` (nueva) | `id`, `workspace_id`, `name` (1–80), `description` (≤ 500), `priority int` (0–1 000 000), `triggers text[]` (subconjunto no vacío de `IMPORT`, `MANUAL_CREATE`, `RETROACTIVE`), `match_mode` (`ALL\|ANY`), `conditions jsonb`, `actions jsonb`, `schema_version smallint`, `stop_processing bool`, `enabled bool`, `needs_attention bool`, `archived_at`, `version int` (versión de definición), `row_version int` (ETag), `created_at`, `created_by`, `updated_at`. Único `(workspace_id, lower(name)) WHERE archived_at IS NULL`; CHECK de docs/08 §5.13 (1–20 condiciones contando las de grupos, 1–10 acciones). Índices `(workspace_id, priority, created_at, id) WHERE enabled AND archived_at IS NULL`; `gin (actions jsonb_path_ops)` | RLS forzada por `workspace_id`; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT; registro en `platform.workspace_scoped_table` |
| `rules.rule_version` (nueva) | `workspace_id`, `rule_id`, `version`, `snapshot jsonb` (nombre, triggers, match_mode, conditions, actions, stop_processing, schema_version), `created_at`, `created_by`; PK `(workspace_id, rule_id, version)` | RLS forzada; append-only (SELECT, INSERT); registro en `workspace_scoped_table` |
| `txn.transaction_split` | `category_origin text NULL CHECK IN ('MANUAL','RULE','COUNTERPARTY_DEFAULT','SYSTEM_DEFAULT')` (NULL ⇒ `UNKNOWN`), `category_rule_id uuid NULL`, `category_rule_version int NULL`, `rule_refs jsonb NULL`; CHECK `(category_origin = 'RULE') = (category_rule_id IS NOT NULL)`; índice parcial `(workspace_id, category_rule_id) WHERE category_rule_id IS NOT NULL AND superseded_in_revision IS NULL` | Sin cambio de RLS |
| `txn.transaction` | `review_status text NULL CHECK IN ('PENDING')`, `review_reason text NULL CHECK IN ('RULE','USER')`, `review_rule_id uuid NULL`, `review_rule_version int NULL`, `review_marked_at timestamptz NULL`; índice parcial `(workspace_id, transaction_date DESC) WHERE review_status = 'PENDING'` | Sin cambio de RLS |

Columnas nulas sin default: `ALTER TABLE … ADD COLUMN` sin reescritura; índices con `CREATE INDEX CONCURRENTLY` en migraciones aparte. Export del workspace: secciones `rules` y `rule-versions` (orden posterior a Classification) y las columnas nuevas de Transactions; demo: `workspace_scoped_table`.

## Rendimiento

- Evaluación: 5 000 sujetos × 200 reglas × 5 condiciones ≈ 5·10⁶ comparaciones sobre texto ya normalizado y `Decimal` precompilados: objetivo ≤ 3 s (benchmark nightly, TC-RULES-ENGINE-050). El peor caso (500 reglas de 20 condiciones) se mide e informa; no tiene umbral.
- Creación manual: +≤ 20 ms al p95 (TC-RULES-ENGINE-051, benchmark de NFR-PERF-003).
- Dry-run: 1 consulta keyset de ≤ 5 000 sujetos + evaluación ≤ 3 s; cuota `costly`.
- Conexiones: **sin consumidores ni colas nuevas**; el presupuesto de D249 no cambia.

## Riesgos / Trade-offs

- **Reglas demasiado amplias** clasifican mal en masa (RISK-016 indirecto): mitigado con vista previa obligatoria del import, dry-run antes de aplicar, origen visible por campo y la cobertura que descuenta correcciones.
- **Cambio de semántica respecto de docs/05/ARCHITECTURE §7** (sin aplicación asíncrona): documentado; si el owner quiere reglas que reclasifiquen solas lo ya persistido, es un change aparte con consumidor y presupuesto propio.
- **Coordinación con `add-import-pipeline`**: si ese change no lleva la clasificación a `RecordImportedTransactions`, el 70 % no es medible. Mitigación: contrato fijado aquí y tarea de verificación cruzada (1.3).
- **Regex**: dependencia nueva (motor lineal) con revisión de licencia; alternativa sin dependencia: quitar `matches_regex` (no recomendado, es Must en FR-RULES-003).
- **Textos importados no confiables**: los textos de reglas y descripciones se escapan en la UI (como `add-basic-csv-import`); una regla nunca ejecuta código.

## Plan de migración

1. Migración `rules` (schema, tablas, RLS, grants, `workspace_scoped_table`).
2. Migración `txn` (columnas nulas) y migraciones aparte con los índices `CONCURRENTLY`.
3. Despliegue del código: las filas antiguas quedan con origen `UNKNOWN`; sin backfill (no se puede saber su origen).
4. Rollback: el código anterior ignora las columnas nuevas; las tablas `rules` quedan sin uso. Ninguna migración es destructiva.

## Dependencias entre changes

- **`add-import-pipeline` (Phase 6, en paralelo):** consume `RuleEvaluationQuery` (§ Contratos) en la etapa de reglas con el orden de la decisión 4; guarda la propuesta y su origen por campo en el staging; muestra regla y versión en la vista previa; ofrece "reevaluar reglas"; pasa `ImportedClassificationDto` a `RecordImportedTransactions`; incluye la cobertura del import en el resumen final. **Bloquea** la medición del criterio de salida, no la implementación de RULES (el contrato y el evaluador se prueban con sujetos sintéticos). Verificado contra su borrador del 2026-10-29: evalúa las reglas en el worker antes de los duplicados y de las coincidencias con compromisos (compatible con la decisión 4), conserva lo editado al reevaluar, deja las filas sin propuesta con la advertencia `IMPORT_RULES_UNAVAILABLE` si la evaluación falla, mide la vista previa con 200 reglas activas y muestra la cobertura del import ("Resumen final con la cobertura de reglas"). Las filas marcadas como transferencia o conversión en su vista previa no pasan por reglas (decisión 13).
- **`add-bulk-imported-transactions` (Phase 6):** implementa el camino por lote de `RecordImportedTransactions` (D152, lotes de hasta 1 000 filas). `ImportedClassificationDto` se agrega a su fila; por su decisión 6, el change que llegue segundo lo integra en el camino por lote (validación de referencias por conjunto y origen por split en la escritura masiva).
- **`add-banking-providers`:** las filas de exchanges (ingresos, gastos y comisiones) pasan por la misma etapa de reglas; las conversiones no (decisión 13).
- **change 41 (`add-exchange-house-rate-providers`) y docs/38 §2:** los extractos reales (formatos de BCP, Ganadero, BISA, BNB) son la entrada de la evidencia del owner.
- Phase 1–2: `classification/*`, `transactions/bulk-edit`, `transactions/transaction-recording`, `identity/workspace-portability`.

## Preguntas abiertas

1. **[B] Semántica de evaluación.** Opciones: (a) primera coincidencia; (b) acumulativa, última gana; (c) acumulativa, primer escritor gana por campo, con `stopProcessing`. **Recomendación: (c)** (decisión 2): es la lectura literal de FR-RULES-006 y permite reglas pequeñas que se componen. Bloquea el grupo 2 (dominio).
2. **[B] Qué cuenta como "clasificada por reglas" para el 70 %.** Opciones: (a) solo `category_origin = RULE` vigente (las corregidas a mano no cuentan); (b) `RULE` al momento de importar, aunque se corrija después; (c) `RULE` + `COUNTERPARTY_DEFAULT` (toda clasificación automática). **Recomendación: (a)**: mide reglas útiles; el desglose muestra (b) y (c) para comparar. Bloquea el grupo 3 (cobertura) y la evidencia.
3. **Acciones de FR-RULES-005 fuera de Phase 6.** "Split por porcentajes" y "vincular a meta" no se piden para el 70 % y agregan casos (largest remainder sobre splits, movimientos de metas). Opciones: (a) diferirlas a Phase 7; (b) incluirlas como Could. **Recomendación: (a)**, con nota en docs/01.
4. **Reglas sobre transferencias y conversiones** ("PAGO TARJETA" ⇒ transferencia a la tarjeta, docs/13 §4.1). Opciones: (a) fuera de Phase 6: el pipeline ofrece marcar la fila como transferencia a mano; (b) acción `MARK_AS_TRANSFER` con cuenta destino. **Recomendación: (a)** para Phase 6; si en los 3 meses del owner esas filas pesan en el 25–30 % restante, se agrega (b) como change aparte.
5. **Disparador de creación manual por defecto.** Opciones: (a) las reglas nuevas no lo traen (opt-in por regla, FR-RULES-009 "opcional por regla"); (b) lo traen. **Recomendación: (a)**.
6. **Aplicación asíncrona posterior (ARCHITECTURE §7).** Opciones: (a) no hay aplicación asíncrona en Phase 6 (decisión 3); (b) consumidor `rules.on-transaction-created` con concurrencia 1. **Recomendación: (a)**: sin consumidor nuevo (D249) y sin cambiar lo aprobado.
7. **Límites.** 500 reglas por workspace, 20 condiciones, 10 acciones, dry-run de 366 días y 5 000 transacciones, aplicación de 500 por operación. **Recomendación:** aceptarlos; son configurables (`RULES_*` en `@pf/platform`).

## Cambios a docs compartidos

- **docs/01:** FR-RULES-005 (nota: split por porcentajes y vincular a meta diferidos si se acepta la pregunta 3; excluir del import solo con disparador de importación); FR-RULES-006 (semántica "primer escritor gana por campo"); FR-RULES-010 (origen por campo en el split); nota en FR-IMPORTS-008.
- **docs/05 §2.13:** RULES sin consumidores en v1; dependencia de Classification y Transactions por contratos; Transactions usa `RuleSuggestionPort` con adaptador en la composición.
- **docs/08 §5.13:** `rules.rule` con `triggers text[]`, `needs_attention`, `row_version`; `rules.rule_version` en lugar de `rules.rule_execution` (decisión 6); columnas nuevas de `txn.transaction_split` y `txn.transaction`; secciones del export.
- **docs/10:** operaciones de Rules, campos aditivos de Transactions, códigos `RULE_INVALID_REGEX`, `RULE_LIMIT_EXCEEDED`, `RULE_DRY_RUN_STALE` en §9.1.
- **docs/11:** sin eventos nuevos (nota: la aplicación de reglas reutiliza los de la edición masiva).
- **docs/13 §4.1 etapa 6 y §17:** orden alias → reglas → categoría por defecto; reglas no marcan transferencias en Phase 6.
- **docs/24 §5.6:** definición exacta del 70 % y cómo se mide (decisión 11).
- **docs/28:** pantalla de reglas, origen por campo, filtro de revisión.
- **ARCHITECTURE §7:** quitar "Rules sobre transacciones importadas" del asíncrono; evaluación síncrona en import y en creación manual.
- **docs/config-reference.md:** `RULES_MAX_PER_WORKSPACE`, `RULES_DRY_RUN_MAX_DAYS`, `RULES_DRY_RUN_MAX_TRANSACTIONS`, `RULES_APPLY_MAX_ITEMS`.
- **docs/03 §7:** posición de `add-rule-engine` en Phase 6 (antes o en paralelo de `add-import-pipeline`; la medición del 70 % requiere ambos).
- **docs/38:** estado del change y la evidencia del owner en §2.
