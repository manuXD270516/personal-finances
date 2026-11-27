# Propuesta: fix-demo-goal-plan-anchor

## Why

La carga del dataset Demo termina `FAILED` con `DemoModuleError: occurrence {"type":"goalPlan","key":"emergency"} of 2025-12-30 not found` cuando la ancla («hoy» en America/La_Paz) deja el día del plan del Fondo de emergencia en 29-31. Desde el 2026-11-25 (`A − 25` = 31-oct) bloquea en `main` las pruebas `integration` (`seed-demo`, `demo-data`) y `e2e` (`demo-data`, `cash-flow-forecast`) de todos los PR; también afecta al producto (quien cargue la demo esos días).

Causa: `buildGoals` generaba los aportes con `renewalDates(firstContribution, 'MONTHLY', anchor)`, que toma el día de la primera fecha. Con día de plan 31 la primera fecha ya viene recortada (`2025-11-30`) y la serie se encadena en día 30 (`2025-12-30`, `2026-01-30`…). La regla de recurrencia del dominio (`monthDays: [31]`) resuelve cada mes desde el día del plan con tope al último día (`2025-12-31`), así que la ocurrencia esperada no existe.

Anclas afectadas (barrido 2025-2027): 23, 24 y 25 de febrero (día de plan 29-31 según el año), 25 de abril, 25 de junio, 25 de septiembre y 25 de noviembre; 20 de 1096.

## What Changes

- `plan-modules/goals.ts`: `monthlyPlanDates` deriva cada fecha del día del plan con tope al último día del mes (misma regla que el dominio); reemplaza el uso de `renewalDates` para los aportes de metas.
- Pruebas: barrido unitario de 3 años de anclas contra la regla del dominio (`goals.test.ts`) y carga completa con la ancla 2026-11-25 (`demo-v2.int.test.ts`), TC-IDENTITY-DEMO-026.
- Spec: 1 requirement MODIFIED en `identity/demo-data` (scenario nuevo).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `identity/demo-data`: el requisito de contenido determinista suma el scenario de la ancla con día de plan 29-31 (1 MODIFIED, Must).

## Impact

**Specs:** `identity/demo-data` (1 MODIFIED). **Componentes:** `apps/api` (dataset del demo). **APIs, eventos, tablas y migraciones:** ninguno. **Test cases:** AÑADIDO TC-IDENTITY-DEMO-026.

**Riesgos:** con la ancla 2026-09-30 (día de plan 5) el dataset y el golden summary son idénticos. Las demás series mensuales con `renewalDates` parten de una fecha que ya es la del dominio (suscripciones, seguro), sin cambio.
