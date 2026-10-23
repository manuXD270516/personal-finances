# Propuesta: optimize-rls-policy-overhead

## Why

El benchmark nocturno de sobrecosto de RLS (criterio de `fix-nightly-pipeline`: 200 pares intercalados e IC95) demostró un sobrecosto real en la fila bloqueante «saldo por cuenta (índice INCLUDE)»: en la corrida 39669892721 (2026-10-21) la consulta tarda 2,80 ms con la política y 1,99 ms sin ella, una diferencia de 0,805 ms (IC95 [0,800, 0,811] ms), entre 40 % y 55 % según la corrida, frente al objetivo de < 10 % de D43. El agregado sintético de todo el workspace (informativo) suma 7,8 ms sobre ~200 000 filas.

El diagnóstico (docs/23 §5.5, EXPLAIN del issue #147) muestra que `platform.current_workspace_id()` **no** se evalúa por fila: aparece una sola vez como `One-Time Filter` en un nodo `Result` que el planner coloca sobre el `Index Only Scan`. El `Index Only Scan` cuesta lo mismo con y sin RLS (207 buffers, Heap Fetches 0); el sobrecosto es ese nodo `Result` adicional, por el que pasan todas las filas (≈ 55 ns por fila) antes del `Aggregate`. Crece con el historial: `ledger.posting` es la tabla más grande. El owner eligió optimizarlo en un change aparte, sin pasar la fila a informativa (D287, docs/46).

## What Changes

- **Experimento previo** que mide en PostgreSQL 18 varias formas de escribir la política (la principal: comparar con `(SELECT platform.current_workspace_id())`, que el planner resuelve como InitPlan) y elige la que quita el nodo por fila sin perder aislamiento ni el uso del índice y sin que el contexto ausente conceda acceso a ninguna fila.
- **Reescritura de las políticas de aislamiento** que usan el contexto de workspace con la forma elegida, en una migración nueva con `ALTER POLICY` explícitos y su reversa, incluidas las políticas que crean funciones en tiempo de ejecución (particiones de auditoría). RLS sigue habilitada y forzada en todas las tablas, y el registro en `platform.workspace_scoped_table` no cambia.
- **Pruebas de aislamiento ampliadas:** las de RLS existentes siguen verdes sin cambios; se agregan pruebas que demuestran que no hay fuga entre workspaces con la forma nueva, que sin contexto ninguna operación lee ni escribe filas en ninguna tabla registrada (`PF002`, o vacío o rechazo sin fila afectada, D297), y que el plan con política no agrega nodos por fila.
- **Fail-closed enmendado (D297, [docs/49](../../../docs/49-rls-failclosed-decision.md)):** con la forma elegida, sin contexto una operación que no llega a evaluar ninguna fila (tabla sin filas) devuelve vacío o es rechazada por otra restricción en lugar de `PF002`. El owner lo aceptó: el requirement «Aislamiento fail-closed sin contexto de workspace» se modifica para exigir el invariante de seguridad (sin contexto no se lee ni se escribe ninguna fila de ningún workspace; el contexto ausente nunca concede acceso) y deja de exigir `PF002` cuando la operación no evalúa filas.
- **Regla de catálogo:** el quality gate falla si una migración agrega una política de aislamiento sin la forma canónica.
- **Medición antes y después** con el benchmark nocturno: antes, la corrida 39669892721; después, `nightly` por `workflow_dispatch` desde la rama del PR y la primera corrida programada tras fusionar.
- **Fuera de alcance:** cambiar el umbral del 10 %, el piso de 0.5 ms (D286) o qué consultas son bloqueantes (D43); quitar el filtro explícito por workspace de las consultas de la aplicación; cambiar `platform.current_workspace_id()` de forma que deje de fallar sin contexto; las políticas que no usan el contexto de workspace (`USING (true)` de roles de mantenimiento, `platform.demo_purge_target()`, outbox); los síntomas de rendimiento bajo carga (`investigate-perf-under-load`).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `security/access-control`: reescritura de las políticas sin pérdida de aislamiento; las políticas no agregan trabajo por fila al plan; forma canónica obligatoria para las políticas nuevas (3 requirements ADDED: 1 Must, 2 Should); el fail-closed sin contexto exige que no se lea ni escriba ninguna fila, con `PF002` o vacío o rechazo sin fila afectada (1 requirement MODIFIED, Must, D297).

## Impact

**Specs impactadas:** `security/access-control` (3 requirements ADDED y 1 MODIFIED, «Aislamiento fail-closed sin contexto de workspace», D297; los otros 8 existentes no cambian: aislamiento por workspace, contexto por transacción, privilegios mínimos y tablas con aislamiento obligatorio siguen igual). Leída sin cambios: `platform/delivery-pipeline` (criterio de sobrecosto de RLS de `fix-nightly-pipeline`).

**Componentes/contextos impactados:** base de datos (políticas RLS de todos los contextos con tablas de negocio, y la función `audit.protect_partition`); `apps/api/db/migrations/` (una migración nueva); `apps/api/test/support/db.ts` (regla de catálogo) y `apps/api/test/db/rls-isolation.int.test.ts` (pruebas nuevas); harness de rendimiento `apps/api/test/perf/nightly.perf.ts` (solo lectura del resultado). Ningún código de dominio, aplicación ni interfaz cambia: las consultas de la aplicación siguen iguales.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna en su estructura; cambian las expresiones de las políticas de aislamiento de las tablas registradas en `platform.workspace_scoped_table` que comparan `workspace_id` con `platform.current_workspace_id()` (entre ellas `ledger.posting`, `ledger.journal_entry`, `ledger.balance_snapshot`, `ledger.entry_reversal`, `ledger.ledger_account` y las particiones de `audit.audit_log`). El alcance son **todas** las políticas que usan el contexto de workspace, después de validar la forma en `ledger.posting` (D294, [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** una, nueva, con timestamp posterior a la última de `main` al implementarla (hoy `20261019100100`). Cambia expresiones de políticas, no columnas ni datos: compatible con la versión desplegada de la aplicación en ambos sentidos (mismo aislamiento; la aplicación siempre fija el contexto), sin fases expand/contract; con reversa que restaura la expresión anterior. No destructiva. Ninguna migración fusionada se edita.

**Test cases:** AÑADIDOS — TC-SECURITY-RLS-006..011 (6). MODIFICADOS — ninguno: TC-SECURITY-RLS-001..005 y TC-SECURITY-ISOLATION-001 se ejecutan sin cambios como regresión (TC-SECURITY-RLS-002 usa tablas con filas y sigue exigiendo `PF002`); TC-SECURITY-RLS-007 se reescribió con el invariante de D297; TC-PLATFORM-PIPELINE-015..017 sin cambios (el criterio no cambia). DEPRECADOS — ninguno.

**Impacto de regresión:** toda consulta de la aplicación pasa por las políticas reescritas; la suite de integración completa (Testcontainers) y los tests de aislamiento son la red. El job `perf` debería dejar de fallar por la fila RLS INCLUDE; si no, sigue en rojo (D285).

**Riesgos introducidos:** riesgo de seguridad si la forma nueva debilita el aislamiento o permite leer o escribir filas sin contexto (mitigado por la prueba del invariante sin contexto por tabla, con la tabla vacía y con filas de otro workspace, y por la regla de catálogo); pérdida de la señal ruidosa `PF002` en tablas sin filas, aceptada por el owner (D297); que ninguna forma quite el nodo `Result` (el design lo trata como hipótesis a medir; si se da, el change se detiene antes de migrar y vuelve al owner con la evidencia, D295); planes distintos en otras consultas (lo detecta la brecha estructural del benchmark de RLS).

**Invariantes afectadas:** ninguna financiera (no cambia dinero, ledger, FX, periodos ni redondeo). Protege NFR-SEC-003 (aislamiento por workspace) y NFR-SEC-004.
