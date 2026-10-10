# 33 — Decisiones del owner de la consolidación de Phase 2

> **Estado:** Aceptado por el owner · **Fecha:** 2026-10-08 · **Relacionado:** [32-phase-2-consolidation-questions.md](32-phase-2-consolidation-questions.md) (preguntas originales, con contexto y opciones), [31-phase-1-consolidation-decisions.md](31-phase-1-consolidation-decisions.md) (D1–D57), [03-openspec-strategy.md](03-openspec-strategy.md) §7, changes de Phase 2 en `openspec/changes/`

El owner respondió el 2026-10-08 las 52 preguntas de [docs/32](32-phase-2-consolidation-questions.md). Numeración: la pregunta **N** de docs/32 es la decisión **D(58+N)** (Q1 → D59 … Q52 → D110); D111 es una decisión de seguimiento sobre Q8 + Q16. La numeración continúa la de docs/31 (D1–D57); D58 no se usa en este documento.

Resumen: se acepta la recomendación de docs/32 en **50** preguntas. **Cambian respecto de la recomendación** Q16 (D74: se **conserva** el marcado directo como modo explícito "conciliada sin extracto") y su seguimiento D111 (esas cuentas cuentan como conciliadas para el cierre, pero marcadas para revisión). Q25 (D83) acepta la recomendación, que difería de la spec redactada (proyección lineal para todas las líneas), y por eso cambia la spec de `add-budgets`.

Los 11 changes de Phase 2 se alinearon en el mismo commit: cada pregunta de la sección "Preguntas abiertas" de su `design.md` indica la decisión que la resuelve, y las specs y los TCs reflejan las decisiones. Los TCs de Phase 2 pasan a `requirement_status: confirmed` (misma convención que Phase 1 tras sus decisiones, commit `dd42c73`).

## Periodos y cierre

| ID | Pregunta | Decisión |
|---|---|---|
| D59 | Q1 [B] Etiqueta del periodo con día de inicio ≠ 1 | **Mes de inicio**: el periodo del 2026-10-25 al 2026-11-24 es "2026-10". Ya especificado en `planning/financial-periods`. |
| D60 | Q2 [B] Varios periodos `active` pendientes de cierre | Se permiten varios periodos `ACTIVE` ya terminados, **marcados "pendiente de cierre"**; sin estado extra `pending_close`. Ya especificado. |
| D61 | Q3 [B] Cambio del día de inicio con planes futuros | Se **recalculan los periodos `DRAFT` conservando su identidad y su plan**. Ya especificado. |
| D62 | Q4 [B] Fecha mínima de planificación | **Cobertura automática desde el asiento más antiguo** en Phase 2; un setting `planningStartDate` queda para un change posterior si molesta. Ya especificado. |
| D63 | Q5 [B] Anticipación por defecto | **3** periodos `DRAFT` futuros, configurable por entorno con `PLANNING_PERIOD_LOOKAHEAD` (no por workspace). Ya especificado. |
| D64 | Q6 [B] Provisión de los periodos iniciales | **Asíncrona** (consumidor de `WorkspaceCreated` + cron). Ya especificado. |
| D65 | Q7 [B] Alcance de la edición en periodos cerrados (extensión de D49) | En un periodo cerrado se **rechazan** con `PERIOD_CLOSED` los cambios de categoría, tags, contraparte, custom fields y las transiciones `clear`/`unclear`/`reconcile`/`unreconcile` (incluida la conciliación sin extracto, D74); se **permiten** notas, descripción, adjuntos y medio de pago. Requirement único "Alcance de la edición en periodos cerrados" de `planning/month-closing`, que aplican `add-reconciliation`, `add-custom-fields` y `add-bulk-edit`. |
| D66 | Q8 [B] ¿Las cuentas sin conciliar bloquean el cierre? | **Bloqueantes por defecto**, igual que las transacciones `pending`; el **OWNER puede bajar cada ítem a advertencia** con la política de cierre. Ya especificado. Ver D111 para las cuentas conciliadas sin extracto. |
| D67 | Q9 Reapertura por EDITOR | **Solo OWNER** reabre; el EDITOR cierra. |
| D68 | Q10 Reapertura en cascada | **Sin cascada**: se reabre en orden inverso (`PERIOD_NEXT_CLOSED`). |
| D69 | Q11 Transacciones `pending` con fecha en un periodo cerrado | **Se rechaza** crearlas o editarlas con `PERIOD_CLOSED`. Nuevo requirement "Transacciones pendientes en periodos cerrados" de `transactions/transaction-recording` en `add-month-closing` (TC-TRANSACTIONS-PENDINGCLOSED-001). |
| D70 | Q12 Cerrar antes del fin del periodo | **Nunca** (`PERIOD_NOT_ENDED`), ni siquiera el último día. |
| D71 | Q13 Cuentas exentas de conciliación | **Sin exenciones** en Phase 2; una marca por cuenta "excluir del checklist" queda para un change posterior. |
| D72 | Q14 Definición de "sin categoría" | Porciones posteadas con `UNCATEGORIZED`/`UNCATEGORIZED_INCOME` (D9); transferencias y conversiones no cuentan. |
| D73 | Q15 Patrimonio del snapshot sin tasa | Snapshot `complete: false` con montos sin convertir, **sin bloquear** el cierre y con aviso informativo; misma política de tasa que `reporting/net-worth` (D29, D48, D53). |

## Conciliación

| ID | Pregunta | Decisión |
|---|---|---|
| D74 | Q16 [B] Marcado directo `reconciled` sin sesión | **Cambia respecto de la recomendación.** Se **conserva** el marcado directo como modo explícito **"conciliada sin extracto"**; no existe `RECONCILIATION_SESSION_REQUIRED`. Toda transacción `RECONCILED` lleva `reconciliationMode`: `STATEMENT` (al finalizar una sesión contra un extracto) o `WITHOUT_STATEMENT` (marcado directo, que exige indicar el modo explícitamente). El marcado sin extracto se audita, registra su propia transición del recorrido (`RECONCILE_WITHOUT_STATEMENT`, distinta de `RECONCILE`), respeta los periodos cerrados (D65) y se distingue en la API, en la UI y en los filtros (D111). Una sesión posterior que la cubre con diferencia 0 la coteja: pasa a `STATEMENT` como anotación del recorrido, sin cambiar de estado. |
| D75 | Q17 Ajuste categorizado | **No** en Phase 2: el ajuste va a `EQUITY:ADJUSTMENTS` (FR-TRANSACTIONS-017); si la diferencia es una comisión conocida, se registra el gasto y se vuelve a finalizar. |
| D76 | Q18 Conciliar cuentas `CLOSED` | **No**: se concilia antes de cerrar la cuenta. |
| D77 | Q19 `RECONCILED` de Phase 1 sin sesión | Se **conservan** como "conciliadas sin extracto": la migración las marca `reconciliationMode = WITHOUT_STATEMENT` (no se reescribe la historia ni se devuelven a `cleared`). Coherente con D74. |

## Seguimiento de la conciliación sin extracto (Q8 + Q16)

| ID | Tema | Decisión |
|---|---|---|
| D111 | Cuentas conciliadas sin extracto en el cierre de mes | Para el cierre, una cuenta cuyas transacciones están conciliadas **sin extracto** **cuenta como conciliada**, pero queda **marcada para seguimiento**: (a) el checklist de cierre la muestra en un ítem informativo propio, **"conciliada sin extracto — pendiente de revisión"** (`RECONCILED_WITHOUT_STATEMENT`, severidad `INFO`: nunca bloquea ni exige reconocimiento y no es configurable en la política); (b) el snapshot de cierre registra, por cuenta, la base de la conciliación (`STATEMENT` o `WITHOUT_STATEMENT`) y la lista de transacciones del periodo conciliadas sin extracto; (c) se pueden listar y filtrar después: marca de sistema **`RECONCILED_WITHOUT_STATEMENT`** en `systemFlags` de la transacción y filtro `systemFlag=RECONCILED_WITHOUT_STATEMENT` en el listado, y conteo por cuenta en el estado de conciliación (indicador "pendientes de revisión"). Se elige una **marca de sistema dedicada, derivada y no editable** en lugar de un tag reservado porque: los tags son clasificación del usuario (se agregan y quitan a mano y en lote, y se renombran o archivan), alimentan presupuestos y reportes por tag (un tag de sistema los contaminaría), en periodos cerrados no se pueden cambiar (D65) y podrían desincronizarse del estado real; la marca se deriva de `reconciliationMode`, que es la única fuente de verdad, así que no puede divergir y viaja sola en el export. `getCoverage`: `reconciledThrough` = sin transacciones `posted`/`cleared` hasta el corte **y** (extracto completado con fecha ≥ corte **o** alguna conciliada sin extracto posterior al último extracto); nuevo `reconciliationBasis` (`STATEMENT`, `WITHOUT_STATEMENT` o `null`) y `reconciledWithoutStatementCount` en el rango consultado. |

## Presupuestos y plantillas

| ID | Pregunta | Decisión |
|---|---|---|
| D78 | Q20 Planes multi-moneda | **Un plan por periodo en moneda base** en Phase 2; la columna `currency` permite relajarlo con un *expand*. |
| D79 | Q21 Cambio de moneda base con planes y templates | Los planes conservan su moneda y convierten el gastado; al aplicar un template se omiten las líneas de otra moneda (`CURRENCY_MISMATCH`) sin convertir montos planificados; el cambio no se bloquea. |
| D80 | Q22 Varios umbrales cruzados a la vez | **Un hecho** con el umbral más alto y `alsoCrossed`. |
| D81 | Q23 Umbrales en líneas de mínimo e ingresos | **Sin umbrales** en Phase 2; los avisos de "mínimo no alcanzado" llegan con los insights de Phase 7. |
| D82 | Q24 Umbrales con gastado incompleto | Se evalúan con la parte convertida y se reevalúan con `fx.RateRecorded.v1`; **nunca 1:1**. |
| D83 | Q25 Proyección lineal en líneas fijas | **Proyección solo en `MAXIMUM`, `RANGE` y `PERCENT_OF_INCOME`**; las líneas `FIXED` y `MINIMUM` no proyectan (`projection: null`) y muestran "pendiente" o "cumplido". **Cambia la spec** `planning/budgets`, que proyectaba todas las líneas (TC-PLANNING-BUDGET-022). |
| D84 | Q26 "Guardar plan como template" desde un plan sin template | Se rechaza con `BUDGET_NO_TEMPLATE_ORIGIN`; la UI ofrece "crear template con estas líneas" (`createTemplate`, sin endpoint nuevo). |
| D85 | Q27 Líneas quitadas del template al propagar | Se quitan de los planes futuros en borrador **solo si no fueron modificadas a mano** (si lo fueron, conflicto). |
| D86 | Q28 Periodo de referencia al propagar | Periodos en borrador con inicio posterior a hoy en la zona del workspace. |

## Alertas y correo

| ID | Pregunta | Decisión |
|---|---|---|
| D87 | Q29 Proveedor de email de producción | Se elige en el change de despliegue con un ADR corto (relay SMTP + API HTTP con `Idempotency-Key`, plan gratuito); mientras tanto producción con `EMAIL_DRIVER=none` (solo in-app). |
| D88 | Q30 Email activado por defecto | **Activado** para ambos tipos, con los detalles desactivados. |
| D89 | Q31 VIEWER como destinatario de umbrales | **Sí**; el cierre pendiente solo a OWNER/EDITOR. |
| D90 | Q32 Aviso de violación de invariante | Change posterior cuando el job de integridad publique `ledger.IntegrityViolationDetected.v1`; tipo `CRITICAL` que ignora el horario de silencio. |
| D91 | Q33 Filtro de email por umbral | **No** en Phase 2 (solo activar/desactivar por tipo y canal). |
| D92 | Q34 Auditar lectura/archivo de notificaciones | **No**; sí se auditan los cambios de preferencias. |
| D93 | Q35 Retención de notificaciones | **12 meses** (docs/08 §13.1) para todas, archivadas incluidas. |

## Edición masiva y campos personalizados

| ID | Pregunta | Decisión |
|---|---|---|
| D94 | Q36 `BEST_EFFORT` y ejecución asíncrona de más de 500 ítems | **No** en Phase 2; se evalúa con imports (Phase 6). |
| D95 | Q37 Deshacer una edición masiva | **No** en Phase 2; la auditoría por `bulkOperationId` permite revertir con otra edición masiva. |
| D96 | Q38 Tipos `MULTI_SELECT` y `MONEY` | **No** en Phase 2. |
| D97 | Q39 Custom fields en transferencias y conversiones | **No** en Phase 2; valor de cabecera en un change posterior si hace falta. |

## Export/import

| ID | Pregunta | Decisión |
|---|---|---|
| D98 | Q40 Cifrado del archivo descargado con frase del usuario | **No** en Phase 2 (docs/30 §11: Phase 7+); descarga por HTTPS con advertencia en la UI. |
| D99 | Q41 [B] Importar un export de workspace demo | **Se rechaza** con `EXPORT_FORMAT_UNSUPPORTED` (D36): los datos demo nunca entran a un workspace real; no hay importación con confirmación. |
| D100 | Q42 [B] Atomicidad del import con volúmenes grandes | **Una sola transacción de BD** y límite de **200 MB** (`WORKSPACE_IMPORT_MAX_BYTES`; mayor ⇒ 413 `UPLOAD_TOO_LARGE`, sin crear nada). Sin lotes ni purga parcial en Phase 2. |
| D101 | Q43 Preservar IDs al restaurar | **No**: siempre se remapea (un solo camino probado). |
| D102 | Q44 Retención del export | **7 días** configurable, con eliminación anticipada. |

## Reportes y auditoría

| ID | Pregunta | Decisión |
|---|---|---|
| D103 | Q45 Historia de `includeInNetWorth` | Valor vigente para toda la serie con aviso en la UI; los periodos cerrados usan el valor congelado en su snapshot. |
| D104 | Q46 Ubicación del gráfico de patrimonio | Tarjeta compacta en el Home (6 periodos) con enlace a la vista completa (12). |
| D105 | Q47 ¿EDITOR usa la vista global de auditoría? | Consulta para **OWNER y EDITOR**; export CSV **solo OWNER**. |
| D106 | Q48 Auditar fallos de autorización de no miembros | **Sí**, en el workspace objetivo, con límite de 1 registro por minuto. |

## Decisiones de arquitectura/ADR

| ID | Pregunta | Decisión |
|---|---|---|
| D107 | Q49 [B] ADR-0028 | **ADR-0028 Aceptado** (2026-10-08): el bloqueo del ledger usa el rango del periodo financiero (enmienda D10). Estado actualizado en el ADR y en el índice [adr/README.md](adr/README.md). |
| D108 | Q50 [B] Capability `identity/workspace-portability` | **Capability nueva aceptada** (ARCHITECTURE §14, docs/01). |
| D109 | Q51 Ubicación de la valoración de flujos | Extraer **`FlowValuation` al shared-kernel** (evita el ciclo Planning ↔ Reporting de Phase 7). |
| D110 | Q52 Recorrido de ciclo de vida para planes y templates | **Sin máquina** para `Budget` (sigue al periodo) ni para templates en Phase 2; historia en el audit log; un change pequeño de `audit/lifecycle-timeline` si el owner lo pide. |

## Decisiones posteriores

| ID | Pregunta | Decisión |
|---|---|---|
| D112 | Throughput de los consumidores de eventos (~2 eventos/s por cola, medido en Phase 2) | **Change nuevo `improve-event-throughput`** (orden 24, docs/03 §7), agregado por el owner el 2026-10-09: va después de `add-workspace-export` y antes de cualquier change de Phase 6. **Nota 2026-10-09:** el owner confirmó la meta: backlog de 5 000 eventos en 500 agregados drenado en ≤ 120 s por consumidor con handler trivial (≥ 42 eventos/s); se revisa con el benchmark de imports de Phase 6. Medición y decisión (lotes de 10 + concurrencia 4, no solo concurrencia) en `openspec/changes/improve-event-throughput/design.md`. |
| D113 | Huecos menores reportados al implementar Phase 2 | **Change `fix-phase-2-gaps`** (orden 25), agregado por el owner el 2026-10-09 antes de Phase 3: locale no soportado en `/me`, cuota de operaciones costosas, nombre del actor en el CSV de auditoría e idempotencia del import con archivo. `/patrimonio` sigue fuera de la sidebar por D104. |

No quedan preguntas del owner abiertas en los changes de Phase 2 tras esta ronda.
