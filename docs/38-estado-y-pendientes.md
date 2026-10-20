# 38: Estado del proyecto y pendientes

> **Actualizado:** 2026-10-20 · **Relacionado:** [CLAUDE.md](../CLAUDE.md), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [24-roadmap.md](24-roadmap.md), decisiones [31](31-phase-1-consolidation-decisions.md), [33](33-phase-2-consolidation-decisions.md), [35](35-phase-3-consolidation-decisions.md), [37](37-phase-4-consolidation-decisions.md), [41](41-phase-5-consolidation-decisions.md), cierre de Phase 4 y diseño de Phase 5 [39](39-phase-4-closure-and-phase-5-design.md), preguntas de Phase 5 [40](40-phase-5-consolidation-questions.md) y sus decisiones [41](41-phase-5-consolidation-decisions.md), respuestas del owner [42](42-phase-5-owner-answers-and-decisions.md) y [43](43-phase-5-owner-answers-2026-10-16.md)

Documento vivo. Toda sesión lo lee al empezar y lo actualiza en el mismo PR cuando cambia el estado de un change o se resuelve un pendiente.

## 1. Estado por fase

| Fase | Estado |
|---|---|
| 0 Fundaciones | Completa |
| 1 Núcleo (cuentas, transacciones, ledger, FX, clasificación, dashboard) | Completa y archivada |
| 2 Planificación y control | 10 de 11 archivados; `add-month-closing` fusionado, espera la evidencia del owner (§2) |
| 3 Compromisos e importación | Completa y archivada (persistencia del import ≤ 20 s diferida a Phase 6, D152) |
| 4 Metas y deudas | Completa salvo evidencias del owner (D219): implementada y fusionada; 3 de 6 archivados. Espera evidencias del owner (§2) y el archivado encadenado (§1.1). Informe de cierre: [docs/39](39-phase-4-closure-and-phase-5-design.md) Parte A |
| 5 FX y cripto avanzado | **En curso.** Decisiones en [docs/41](41-phase-5-consolidation-decisions.md) (D219–D250), plan en [docs/39](39-phase-4-closure-and-phase-5-design.md) §B.3. Changes 37 y 40 implementados y archivados (#121, #122, #123); change 38 implementado sin adapters reales (#126) y change 39 implementado (#128); specs fusionadas de 41 (#132), 45 (#127) y de la agrupación de avisos (#131); ADR-0029 propuesto (#130) y aceptado el 2026-10-16 (#143). Agrupación de avisos implementada (#134) y change 41 implementado con catálogo ficticio (#136). Los adapters cripto y las fuentes reales del 41 esperan al owner y a que el entorno permita leer los términos y los listados de ASFI y BCB (§2). Datos demo (44) archivado; change 45 fusionado (#145) y a la espera de que Mend retome la configuración (§2). Respuestas del owner del 2026-10-16: D256–D282 (docs/43) |

### 1.1 Phase 4

| # | Change | Estado | Siguiente paso |
|---|---|---|---|
| 31 | `add-loans` | Fusionado (#101) | Archivar cuando el owner registre la comparación con su banco (§2) |
| 32 | `add-credit-cards` | Archivado (#103) | — |
| 33 | `add-savings-goals` | Archivado (#105) | — |
| 34 | `add-loan-amortization-advanced` | Fusionado (#107), tareas completas | Archivar **justo después** de `add-loans`: agrega requisitos a `debt/loans` y `debt/amortization`, que crea el archive de `add-loans` |
| 35 | `add-debt-summary` | Fusionado (#109), tareas completas | Archivar **después** de `add-loans` y `add-loan-amortization-advanced`: sus specs `debt/loans` son ADDED y chocarían con el archive de `add-loans`. Pendientes de docs: `docs/14` §10, `docs/28`, `docs/03` §7 |
| 36 | `add-spendable-amount` | Archivado (#112 fusionado; PR de archivado: #113) | Ninguna. Supuestos a confirmar por el owner: sin periodo financiero que cubra hoy se usa el mes calendario (sin plan de presupuesto); "N tarjetas sin pago programado" cuenta tarjetas con saldo adeudado sin ocurrencia ni pendiente hacia ellas; benchmark nightly TC-REPORTING-SPENDABLE-014 en BOB (`apps/api/test/perf/spendable.perf.ts`) |

Informe de cierre de Phase 4 y criterios de salida (docs/24 §5.4): [docs/39](39-phase-4-closure-and-phase-5-design.md) Parte A. Cumplidos: Σ principal = principal (TC-DEBT-AMORT-004/005) y pagos de tarjeta fuera del gasto (TC-DEBT-CARD-015, TC-TRANSACTIONS-CARDPAYMENT-001). Pendientes del owner: tabla del banco y metas reales (§2).

### 1.2 Phase 5

Decisiones registradas en [docs/41](41-phase-5-consolidation-decisions.md) (respuestas del owner a P1–P3, P7, P8, P15 y P30; 17 por omisión con la recomendación de docs/40, revertibles; P19–P25 sin efecto). Los changes 37 a 40 ya están redactados; 37 y 40 están implementados y archivados; 38 y 39 implementados (sin archivar). Respuestas del owner del 2026-10-13: [docs/42](42-phase-5-owner-answers-and-decisions.md) (D251–D255).

| # | Change | Estado |
|---|---|---|
| 37 | `fix-phase-4-gaps` | Implementado y archivado (#121, #122; D222) |
| 38 | `add-crypto-rate-providers` | Implementado (#126) **sin adapters reales**. Exchanges del owner: Binance, Bitget y Bybit (D251). ADR-0029 **Aceptado** (2026-10-16, #143): Binance principal y Bybit respaldo, aptas con condiciones C1–C4; Bitget no verificada ni habilitada. Ningún provider pasa a `VERIFIED` hasta la lectura directa de términos. El owner aprobó el acceso a los términos (D256), pero la red del entorno sigue bloqueando los dominios: la tarea 1.5 (leerlos y grabar fixtures) bloquea habilitar los providers; 4.1–4.3, 7.1 y 7.2 siguen pendientes. No se archiva hasta entonces (o hasta diferirlas por escrito) |
| 39 | `add-rate-feed-alerts` | Implementado (#128), tareas completas. Archivar **después** de 38 (D233–D236). El owner pidió agrupar los avisos de anomalía (D253): lo hace `refine-rate-anomaly-alert-grouping` |
| 39b | `refine-rate-anomaly-alert-grouping` | Implementado (#134). Quedan abiertas la tarea 4.4 (email con Mailpit; cubierto con el despachador y un SMTP en memoria) y la 8.1 (la decisión D253 ya está en docs/42; se cierra al archivar). Se archiva después de 39, que va después de 38 |
| 40 | `add-conversion-cost-analysis` | Implementado (#123) y archivado (D231, D244–D247). Trajo el único consumidor nuevo (`fx.user-conversion-observations`); subir `max_connections` antes del despliegue (D249) |
| 41 | `add-exchange-house-rate-providers` | Spec fusionada (#132) e **implementado con catálogo ficticio** (#136); preguntas 1–10 resueltas (D262–D282) y fichas de formato de extractos con fixtures sintéticos de BCP, Banco Ganadero, BISA y BNB (#144, `docs/statement-formats/`; `statementImport` queda `PENDING_SAMPLE`): catálogo de instituciones con estado de soporte por dimensión, adopción, cobertura (`apps/api/reference/institutions/demo/BO.json`, marcado ficticio y rechazado en staging y production) y tasas `BANK_BUY`/`BANK_SELL`. Siguen abiertas, esperando la verificación de fuentes (1.1 necesita acceso a ASFI y BCB): 1.1, 1.2, 1.5, 4.2 (archivo real `BO.json`), 4.3 y 4.4 (adapters), 7.1 y 7.3. La 8.3 quedó hecha en #144. No se archiva hasta cerrarlas o diferirlas por escrito |
| 42, 43 | `add-commodity-prices`, `add-asset-valuations` | Diferidos a Phase 7 o al backlog (D221) |
| 44 | `add-phase-4-demo-data` | Implementado (#139) y archivado:  dataset Demo v2 (suscripciones, tarjetas, metas y préstamos ficticios, carga ~28 s). `demo.purge` ahora espera a los consumidores del worker antes de borrar. Cubre las tareas Could de `add-recurrence-engine` 8.2, `add-subscriptions` 8.3, `add-credit-cards` 8.3 y `add-savings-goals` 8.3 y la 8.3 de `add-loans` (se marca `[x]` al archivarlo, D223) |
| 45 | `add-dependency-updates` | Implementado y fusionado (#145): `renovate.json5`, test de política (`scripts/delivery-policy`), benchmark NFR-PERF-002 y aviso por issue del job `perf`. Abiertas las tareas del owner: 3.1 (verificar la PR de configuración de la app de Mend, no hecha), 3.2 y 3.3 (primera corrida y primera ventana), 4.2 (corrida de `nightly` a escala 1 y p95 de NFR-PERF-002) y 4.3 (verificación manual del issue). No se archiva hasta cerrarlas |
| 46 | `fix-nightly-pipeline` | Implementado y fusionado (#150; seguimiento en la rama `claude/impl-fix-nightly-followup`, 2026-10-20). Resultado de la corrida manual de `nightly` (run 39390841971): `mutation` y `fx-smoke-live` en verde; `regression` ~17 min con archivos completos (la tarea 2.3 no requiere subir el timeout) y rojo solo por `packages/contexts/ledger (unit)` (timeout de 5 s de `[TC-LEDGER-BALANCE-003]` con 10 000 casos; corregido con timeouts explícitos en los PBT y una guarda en el test de política); `perf` con NFR-PERF-002 p95 30 ms OK, dos falsos «plan distinto» (nodos de la política de RLS; corregidos) y dos rojos que siguen por decisión: la fila `saldo por cuenta (índice INCLUDE)` (brecha real de 0,599 ms, IC95 [0,597, 0,602] ms; tarea 5.3 abierta, el EXPLAIN va ahora en `perf-summary.md`) y TC-COMMITMENTS-MATCH-012. Abiertas 3.3 (Planning solos dos veces seguidas), 5.3, 6.1/6.2 y 7.3. Implementación original (grupos 1 a 7): `regression` corre archivos completos (sin `-t`) con estado por grupo, los cinco tests de Planning crean sus datos, cobertura del shared-kernel 99.86 % / 94.69 % con tests propios (umbrales 95/90 intactos y protegidos por el test de política), criterio de RLS con 200 pares e IC95 (veredictos, `ci95Ms`/`pairs`/`verdict` en el JSON, `rls-explain.md`) y helper `perfApiEnv` de cuotas relajadas en todas las suites `*.perf.ts` (TC-PLATFORM-PIPELINE-010..019, automatizados). Sin Docker en la sesión: el integration de Planning (3.3) sigue sin verificar solo y dos veces seguidas. Grupo 8 (preguntas 1 y 2 de [docs/44](44-fix-nightly-pipeline-questions.md)) sin hacer: espera al owner. No se archiva hasta cerrar 3.3, 5.3, 7.3 y el grupo 8. **El nightly seguirá en rojo (`perf`) por la fila de RLS INCLUDE y por TC-COMMITMENTS-MATCH-012 hasta los changes aparte: `investigate-consumer-throughput` y, si el sobrecosto de RLS se confirma con el diagnóstico, un change de optimización (ninguno redactado todavía).** TC-COMMITMENTS-MATCH-012 queda fuera (§4) |

## 2. Esperan al owner

Ninguna sesión puede cerrarlos por su cuenta.

- **Cierre de mes real (Phase 2, `add-month-closing` 7.4, TC-PLANNING-EXIT-001):** cerrar un mes real con todas las cuentas conciliadas. Al tenerlo, se marca la tarea con la evidencia, se automatiza el TC y se archiva el change. Es la advertencia R3 que hoy muestra `traceability:check`.
- **Tabla del banco (Phase 4, `add-loans` 8.4, D154):** el owner carga en la app la tabla de amortización real de su préstamo (nunca en el repositorio) y registra la comparación como `MATCH` o `EXPLAINED`. Si la tabla tiene fechas distintas a las del sistema en cuotas pendientes, revisar la adopción de cronogramas custom (§4).
- **Exchanges cripto (Phase 5, ADR-0029, aceptado):** ampliar la lista de hosts permitidos del entorno (o que una sesión lo haga desde su máquina o el VPS N1) para leer los términos de Binance y Bybit y grabar los fixtures (tarea 1.5 del change 38).
- **Renovate (change 45):** la app ya está instalada (D261) y `renovate.json5` está en `main` (#145). Falta verificar que Mend lo reconozca y cierre su PR de onboarding (#142; no fusionarla, aplicaría la configuración por defecto) (tarea 3.1); revisar la primera corrida y el Dependency Dashboard (3.2); lanzar `nightly` por `workflow_dispatch` a escala 1 y anotar el p95 de NFR-PERF-002 (4.2); y activar Dependabot alerts (D265).
- **Change 41 (bancos y billeteras de Bolivia):** descargar los listados de ASFI y BCB o dar acceso (tarea 1.1). Indicar si cada banco exporta CSV o XLS (hoy `PENDING_SAMPLE`) y compartir un extracto de BISA con movimientos. Los PDF solo en la conversación (nunca en el repositorio; D255, D282).
- **Censo trimestral de entidades (D280):** repetir cada trimestre el censo de bancos y billeteras y los binarios de Trivy y gitleaks (revisión manual).
- **Fuente `OFFICIAL` (D276):** si el BCB califica como fuente oficial, se abre un change aparte; si los términos no están claros, escribir al BCB (D279).
- **Despliegue N1 (Phase 5, D248, ADR-0027):** hacerlo antes de abrir la ventana de 30 días del criterio de salida de Phase 5.
- **Nightly (change 46):** responder las preguntas 1 a 5 de [docs/44](44-fix-nightly-pipeline-questions.md): cobertura del shared-kernel en el job `unit` del PR (toca un check requerido), aviso por issue de `regression` y `mutation`, estado del job `perf` mientras siga en rojo TC-COMMITMENTS-MATCH-012, piso de 0.5 ms del criterio de RLS y qué hacer si ese sobrecosto es real. Ninguna bloquea la implementación (los grupos 1 a 7 usan la recomendación; el grupo 8 solo se hace si adoptas la opción (a) de las preguntas 1 y 2). Tras fusionar, lanzar `nightly` por `workflow_dispatch` y anotar el resultado de `regression`, `mutation` y `perf` (tarea 7.3).
- **Decisiones por omisión de Phase 5** ([docs/41](41-phase-5-consolidation-decisions.md)): el owner puede revertir cualquiera antes de que se redacte el change que la usa.
- **Criterios de salida de uso real:** Phase 2 (uso del owner, exportar e importar el workspace); Phase 3 (registrar sus suscripciones reales y un mes sin recurrentes sorpresa, indicador en `/pagos-proximos`); Phase 4 (metas del owner con estado calculado).

## 3. Diferidos por decisión

- **Persistencia del import CSV ≤ 20 s para 5 000 filas** (hoy ~120 s): Phase 6, con la escritura masiva de `RecordImportedTransactions` (D152). `PF_PERF_STRICT_IMPORT=1` exige la meta.
- **Datos de demostración** de suscripciones, tarjetas, metas y préstamos: hechos en `add-phase-4-demo-data` (44, #139).
- **Commodities y valoración de inversiones** (changes 42 y 43): Phase 7 o backlog; el owner no tiene esos activos (D221).
- **Alerta por falla no transitoria de un provider:** no entra en Phase 5 (D233); sigue visible en el estado de providers.

## 4. Deuda técnica y mejoras conocidas

**Plataforma**
- `overdueStatements[]` del listado de tarjetas puede quedar incompleto; el detalle de la tarjeta sí es completo (change 37).
- La métrica `debt_card_cycle_mismatch_total` no existe en el código (solo `consistent`).
- Conexiones: la plantilla del host suma API 22 + worker 33 = 55 sobre 60 de Postgres. Antes del despliegue, subir `max_connections` o revisar consumidores de concurrencia 1 que podrían agruparse.
- Limitador de tasa en memoria: con más de una réplica de la API hace falta un adaptador sobre Valkey.
- **Rendimiento de los consumidores tras el Large Seed (fuera de `fix-nightly-pipeline`):** en la corrida nightly #12 quedaron 470 165 eventos pendientes en el outbox al terminar la carga y los consumidores procesaron 0.1–8 ev/s frente a los 42 de NFR-PERF-008; el matcher de compromisos no drenó su ráfaga a tiempo (`commitments.perf.ts`, TC-COMMITMENTS-MATCH-012). Puede ser un cuello de botella real, o el backlog del Large Seed compitiendo con la suite siguiente, que comparte la base. Propuesta: un change de investigación aparte, `investigate-consumer-throughput` (perfilar el relay y los consumidores con ese backlog, separar el efecto de la carga previa y decidir si se corrige el producto o el benchmark), sin redactar todavía. Mientras tanto el job `perf` del nightly sigue en rojo por esa fila (pregunta 3 de docs/44).

**Análisis del costo de conversiones (change 40)**
- Memoria de Postgres justa: con 56 conexiones frente al límite de 384 MiB; vigilar tras el despliegue.
- Cada observación `USER_CONVERSION` dispara una reevaluación de presupuestos por workspace (`planning.budget-thresholds` está suscrito a `fx.RateRecorded`).
- Una observación no tiene recorrido ni auditoría de usuario.
- Los tests de integración, API y e2e del change se escribieron sin Docker y se validaron en CI.
- Configuración nueva: variables `FX_*`, consumidor `fx.user-conversion-observations` y job de carga inicial.

**Préstamos y amortización**
- Adoptar una tabla del banco cuyas fechas difieren de las del sistema en una cuota pendiente no está probado (la clave de la ocurrencia es el número de cuota).
- El simulador de pago anticipado no tiene benchmark del p95 < 300 ms; el test usa 3 s.
- La lista de préstamos hace 2 consultas a BD por préstamo (change 37).
- UI: la lista de préstamos consulta cada detalle por separado (máx. 50); un borrador no se edita desde la pantalla (sí por `PATCH`); notas y etiquetas de transacciones `LOAN_*` no se editan desde la UI.

**Tarjetas**
- El ciclo que contiene un saldo inicial queda `consistent = false` (el asiento de apertura no tiene transacción); las cifras son correctas.
- `nextDueDate` puede apuntar a un vencimiento pasado en un ciclo calculado y no emitido, recién registrada una tarjeta con deuda previa.
- Las cuotas no se rotulan como tales en Q8 (el contrato de próximos pagos no lo expone).

**Metas**
- Anular un aporte del que ya se retiró una parte deja el fondo real en negativo; no se bloquea.
- El job diario corre cada hora (`GOALS_DAILY_CRON`); es idempotente.

**Deuda de Phase 4 fuera de D222** (sigue abierta): notas `LOAN_*`, rótulo de cuotas en Q8, supuestos de Q5, job horario de metas y la decisión «Phase 7».

**Disponible para gastar (Q5)**
- Sin un periodo financiero que cubra hoy (workspace sin actividad en el ledger) Q5 usa el mes calendario y no consulta el plan; la spec no define ese caso (supuesto a confirmar).
- "N tarjetas sin pago programado" cuenta las tarjetas con saldo adeudado a las que no llega ninguna transferencia ni pago de tarjeta (ocurrencia o pendiente) hasta el fin del periodo; no distingue pagos mínimos de totales.
- Un aporte manual pendiente hacia una cuenta no líquida de una meta con plan puede contar dos veces hasta postearse (riesgo aceptado en el diseño).
- Fuera de Phase 4: horizonte "hasta el próximo ingreso", categorías esenciales y alertas de déficit (Phase 7, D218).

**Importación CSV**
- `getImport` no devuelve las filas de muestra: al retomar una importación no se ve la muestra.
- Las huellas incluyen workspace y cuenta: reimportar tras restaurar un export muestra "probables duplicados" (documentado en docs/13 §7.3).

**Otros reportados en Phases 1–2** (verificar antes de trabajarlos)
- `GET /me` con un locale guardado no soportado (p. ej. `fr-FR`).
- El bucket de rate limit de edición masiva (10/min) no existe.
- El CSV de la auditoría global muestra el id del actor, no su nombre.
- `/patrimonio` no aparece en la navegación lateral.

## 5. Tests intermitentes vistos

Investigar si reaparecen en CI; todos pasan aislados.

- `TC-CLASSIFICATION-CUSTOMFIELD-010`: "inconsistent types deduced for parameter $2".
- Suite de `month-closing` y `imports.api`: `ECONNRESET`/503 bajo carga local.
- `a11y.spec`: el login inicial no completó en 30 s (arranque en frío del stack E2E).
- `recurring.spec.ts` [TC-COMMITMENTS-RECUR-021/023/031]: falló una vez en CI (`recurring-approval-count` no aparecía) y pasó al repetir.
- TC-AUDIT-LIFECYCLE-001 y TC-COMMITMENTS-RECUR-017 recibieron timeout explícito (#124).

Corregidos: orden de eventos TC-PLATFORM-EVENTS-015 y aviso de guardado TC-PLATFORM-API-014 (#98); consultas pg concurrentes y aserciones con números sueltos (#106); auditoría de periodos en TC-IDENTITY-RESTORE-001 (#102).
