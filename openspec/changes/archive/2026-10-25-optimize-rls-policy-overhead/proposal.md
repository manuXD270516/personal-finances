# Propuesta: optimize-rls-policy-overhead

> **Reconvertido el 2026-10-24 a «no migrar» (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)).** La migración de las políticas a la forma V2 (PR #165) se cerró sin fusionar: quitaba el sobrecosto de la fila INCLUDE pero hacía fallar las dos consultas reales de saldos con otro plan. El change conserva la política actual, pasa la fila INCLUDE a informativa y deja como verificación permanente el aislamiento y el fail-closed tabla por tabla.

## Why

El benchmark nocturno de sobrecosto de RLS (criterio de `fix-nightly-pipeline`: 200 pares intercalados e IC95) demostró un sobrecosto real en la fila bloqueante «saldo por cuenta (índice INCLUDE)»: en la corrida 39669892721 (2026-10-21) la consulta tarda 2,80 ms con la política y 1,99 ms sin ella, una diferencia de 0,805 ms (IC95 [0,800, 0,811] ms), frente al objetivo de < 10 % de D43. El origen es un nodo `Result` con `One-Time Filter` que el planner coloca sobre el `Index Only Scan` (docs/23 §5.5); el owner eligió intentar optimizarlo en este change (D287).

El intento se hizo en dos fases. La fase a (#162) midió cinco formas de la política en el job `integration` (13 000 postings) y solo V2 `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])` quitaba el nodo. La fase b (#165) migró las 125 políticas a V2 y el nightly manual con el Large Seed (run 39931324467) mostró que la fila INCLUDE dejaba de fallar, pero `PgBalanceQuery.getAccountBalances` (+46,8 %) y `getBalance` (+69 %) pasaban a «plan distinto» y brecha, cuando antes pasaban. La consulta real, que es la que mide D43, empeoraba para ganar ~0,8 ms en una consulta de índice. El owner decidió no migrar y pasar la fila INCLUDE a informativa (D298, que aplica D295).

## What Changes

- **Sin migración de políticas.** Se conserva la forma actual `workspace_id = platform.current_workspace_id()` en todas las tablas, con RLS forzada, el registro `platform.workspace_scoped_table` y el fail-closed `PF002` sin cambios. La migración V2 queda en la rama `claude/impl-optimize-rls-policy-overhead-b` por si se retoma con una decisión nueva.
- **Fila INCLUDE informativa.** El benchmark de RLS sigue midiendo y publicando la fila «saldo por cuenta (índice INCLUDE)» con el mismo criterio, marcada como informativa, sin hacer fallar el job `perf`. Las consultas reales de `PgBalanceQuery` y la página de transacciones siguen bloqueantes (D43, D286). Un test de política fija qué filas son informativas.
- **Verificación permanente del aislamiento y del fail-closed** con las políticas vigentes: TC-SECURITY-RLS-006 (cruce W1/W2 en el ledger y cuentas) y TC-SECURITY-RLS-007 (matriz sin contexto por tabla registrada, con los hallazgos de D296 listados), ya activos desde #162.
- **Retiro del código de la forma nueva** que quedó en `main` tras la fase a: las pruebas omitidas de TC-SECURITY-RLS-008, 009 y 011, el interruptor `RLS_POLICY_REWRITE_MIGRATION_PRESENT` y la maquinaria de forma canónica; esos TC se deprecan.
- **Fuera de alcance:** reescribir las políticas (D298); cambiar el umbral del 10 %, el piso de 0.5 ms (D286) o las demás filas bloqueantes (D43); quitar el filtro explícito por workspace de las consultas; corregir el hallazgo de fail-closed de `platform.idempotency_key` e `iam.workspace_export` (D296, change de seguridad aparte); los síntomas de rendimiento bajo carga (`investigate-perf-under-load`).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `security/access-control`: la fila de índice INCLUDE del benchmark de RLS es informativa y la consulta real sigue bloqueante; verificación del aislamiento y del fail-closed tabla por tabla con las políticas vigentes (2 requirements ADDED: 1 Must, 1 Should).

## Impact

**Specs impactadas:** `security/access-control` (2 requirements ADDED; los 9 existentes no cambian, en particular «Aislamiento fail-closed sin contexto de workspace» sigue exigiendo `PF002`). Leída sin cambios: `platform/delivery-pipeline` (criterio de sobrecosto de RLS de `fix-nightly-pipeline`, que sigue igual para las filas bloqueantes).

**Componentes/contextos impactados:** solo soporte de pruebas: `apps/api/test/perf/nightly.perf.ts` (fila INCLUDE con `gate: false`), `apps/api/test/perf/perf-report.test.ts` (test de política de filas informativas), `apps/api/test/db/rls-isolation.int.test.ts` y `apps/api/test/support/db.ts` (retiro del código de la forma nueva y simplificación de TC-SECURITY-RLS-007), `apps/api/test/db/rls-policy-variants.int.test.ts` y sus soportes (retiro del experimento). Ningún código de dominio, aplicación, infraestructura de producción ni interfaz cambia.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna (ni estructura ni políticas).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna (D298). La migración `20261023120000_platform_rls_policy_initplan.sql` de la fase b no se fusiona.

**Test cases:** AÑADIDOS — TC-SECURITY-RLS-006, 007, 010 y 012. MODIFICADOS — ninguno: TC-SECURITY-RLS-001..005, TC-SECURITY-ISOLATION-001 y TC-PLATFORM-PIPELINE-015..017 sin cambios. DEPRECADOS — TC-SECURITY-RLS-008, 009 y 011 (estado posterior a la migración y forma canónica, descartados por D298; pasan a `deprecated` en el mismo commit que retira sus tests, tarea 4.2).

**Impacto de regresión:** ninguno en producción. El job `perf` deja de fallar por la fila INCLUDE y sigue bloqueante por las demás (D285); puede seguir en rojo por TC-COMMITMENTS-MATCH-012 y `spendable.perf` (change 48). El job `integration` pierde el experimento de variantes (13 000 postings) y las pruebas omitidas.

**Riesgos introducidos:** que una regresión real del sobrecosto de RLS en la consulta de índice pase inadvertida al ser informativa (mitigado: se sigue publicando en `perf-summary.md` y la consulta real sigue bloqueante); que se retire por error una prueba activa de aislamiento (mitigado: TC-SECURITY-RLS-001..007 siguen y la tarea 4.2 enumera qué se retira).

**Invariantes afectadas:** ninguna financiera. Protege NFR-SEC-003 y NFR-SEC-004 sin cambiar el fail-closed.
