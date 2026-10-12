# 38: Estado del proyecto y pendientes

> **Actualizado:** 2026-10-12 · **Relacionado:** [CLAUDE.md](../CLAUDE.md), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [24-roadmap.md](24-roadmap.md), decisiones [31](31-phase-1-consolidation-decisions.md), [33](33-phase-2-consolidation-decisions.md), [35](35-phase-3-consolidation-decisions.md), [37](37-phase-4-consolidation-decisions.md)

Documento vivo. Toda sesión lo lee al empezar y lo actualiza en el mismo PR cuando cambia el estado de un change o se resuelve un pendiente.

## 1. Estado por fase

| Fase | Estado |
|---|---|
| 0 Fundaciones | Completa |
| 1 Núcleo (cuentas, transacciones, ledger, FX, clasificación, dashboard) | Completa y archivada |
| 2 Planificación y control | 10 de 11 archivados; `add-month-closing` fusionado, espera la evidencia del owner (§2) |
| 3 Compromisos e importación | Completa y archivada (persistencia del import ≤ 20 s diferida a Phase 6, D152) |
| 4 Metas y deudas | En curso (§1.1) |

### 1.1 Phase 4

| # | Change | Estado | Siguiente paso |
|---|---|---|---|
| 31 | `add-loans` | Fusionado (#101) | Archivar cuando el owner registre la comparación con su banco (§2) |
| 32 | `add-credit-cards` | Archivado (#103) | — |
| 33 | `add-savings-goals` | Archivado (#105) | — |
| 34 | `add-loan-amortization-advanced` | Fusionado (#107), tareas completas | Archivar **justo después** de `add-loans`: agrega requisitos a `debt/loans` y `debt/amortization`, que crea el archive de `add-loans` |
| 35 | `add-debt-summary` | Fusionado (#109), tareas completas | Archivar **después** de `add-loans` y `add-loan-amortization-advanced`: sus specs `debt/loans` son ADDED y chocarían con el archive de `add-loans`. Pendientes de docs: `docs/14` §10, `docs/28`, `docs/03` §7 |
| 36 | `add-spendable-amount` | Archivado (#112 fusionado; PR de archivado: #113) | Ninguna. Supuestos a confirmar por el owner: sin periodo financiero que cubra hoy se usa el mes calendario (sin plan de presupuesto); "N tarjetas sin pago programado" cuenta tarjetas con saldo adeudado sin ocurrencia ni pendiente hacia ellas; benchmark nightly TC-REPORTING-SPENDABLE-014 en BOB (`apps/api/test/perf/spendable.perf.ts`) |

Después de Phase 4: informe de cierre de fase, criterios de salida (docs/24 §5.4) y diseño de Phase 5 con el agente `arquitecto`.

## 2. Esperan al owner

Ninguna sesión puede cerrarlos por su cuenta.

- **Cierre de mes real (Phase 2, `add-month-closing` 7.4, TC-PLANNING-EXIT-001):** cerrar un mes real con todas las cuentas conciliadas. Al tenerlo, se marca la tarea con la evidencia, se automatiza el TC y se archiva el change. Es la advertencia R3 que hoy muestra `traceability:check`.
- **Tabla del banco (Phase 4, `add-loans` 8.4, D154):** el owner carga en la app la tabla de amortización real de su préstamo (nunca en el repositorio) y registra la comparación como `MATCH` o `EXPLAINED`. Si la tabla tiene fechas distintas a las del sistema en cuotas pendientes, revisar la adopción de cronogramas custom (§4).
- **Criterios de salida de uso real:** Phase 2 (uso del owner, exportar e importar el workspace); Phase 3 (registrar sus suscripciones reales y un mes sin recurrentes sorpresa, indicador en `/pagos-proximos`); Phase 4 (metas del owner con estado calculado).

## 3. Diferidos por decisión

- **Persistencia del import CSV ≤ 20 s para 5 000 filas** (hoy ~120 s): Phase 6, con la escritura masiva de `RecordImportedTransactions` (D152). `PF_PERF_STRICT_IMPORT=1` exige la meta.
- **Datos de demostración** de suscripciones, tarjetas, metas y préstamos: tareas Could no hechas; se pueden agrupar en un change de datos demo.

## 4. Deuda técnica y mejoras conocidas

**Plataforma**
- Conexiones: la plantilla del host suma API 22 + worker 33 = 55 sobre 60 de Postgres. Antes del despliegue, subir `max_connections` o revisar consumidores de concurrencia 1 que podrían agruparse.
- Limitador de tasa en memoria: con más de una réplica de la API hace falta un adaptador sobre Valkey.

**Préstamos y amortización**
- Adoptar una tabla del banco cuyas fechas difieren de las del sistema en una cuota pendiente no está probado (la clave de la ocurrencia es el número de cuota).
- El simulador de pago anticipado no tiene benchmark del p95 < 300 ms; el test usa 3 s.
- UI: la lista de préstamos consulta cada detalle por separado (máx. 50); un borrador no se edita desde la pantalla (sí por `PATCH`); notas y etiquetas de transacciones `LOAN_*` no se editan desde la UI.

**Tarjetas**
- El ciclo que contiene un saldo inicial queda `consistent = false` (el asiento de apertura no tiene transacción); las cifras son correctas.
- `nextDueDate` puede apuntar a un vencimiento pasado en un ciclo calculado y no emitido, recién registrada una tarjeta con deuda previa.
- Las cuotas no se rotulan como tales en Q8 (el contrato de próximos pagos no lo expone).

**Metas**
- Anular un aporte del que ya se retiró una parte deja el fondo real en negativo; no se bloquea.
- El job diario corre cada hora (`GOALS_DAILY_CRON`); es idempotente.

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

Corregidos: orden de eventos TC-PLATFORM-EVENTS-015 y aviso de guardado TC-PLATFORM-API-014 (#98); consultas pg concurrentes y aserciones con números sueltos (#106); auditoría de periodos en TC-IDENTITY-RESTORE-001 (#102).
