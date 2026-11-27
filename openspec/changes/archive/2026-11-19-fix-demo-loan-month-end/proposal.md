# Propuesta: fix-demo-loan-month-end

## Why

La carga del dataset Demo termina `FAILED` con `DEMO_GOLDEN_MISMATCH` cuando la ancla («hoy» en America/La_Paz) cae en ciertos días: `educativo installment 1: expected 946.19/120.00, got 942.19/124.00` con las anclas 18, 19 y 20 de noviembre, y `consumo installment 1: expected 1000.00/120.00, got 992.00/128.00` con las del 7, 8 y 9 de septiembre (22 días en 2025-2028). Afecta al producto (cualquier usuario que cargue la demo esos días) y a CI: el 2026-11-18 fallaron `e2e` (cash-flow-forecast, demo-data) y 2 pruebas de integración en #237, sin relación con ese cambio.

Causa: `loanDefinitions` calcula `firstDue` con `addMonthsClamped` y el desembolso como un mes antes. Si `firstDue` cae el 29-31 de marzo, el desembolso se recorta al 28 de febrero y el motor de DEBT (30/360 europeo, `days360European(accrualStart, firstDueDate)`) cobra un primer periodo de 31 o 32 días; el oráculo del plan asume 30. La suma de la cuota coincide pero el reparto interés/principal no.

## What Changes

- `plan-modules/loans.ts`: `cap28` limita a 28 el día de `consumoDue6` y `educativoDue8` antes de derivar las primeras cuotas, de modo que el desembolso nunca se recorte y el primer periodo mida siempre 30 días.
- `plan-modules/cards.ts`: el cierre anterior `k0` de «Tarjeta Kantuta Demo» se deriva de K2 (`addMonthsClamped(k2, -2)`) en lugar de encadenar recortes desde K1.
- Pruebas: barrido unitario de las anclas 2025-2029 y una carga completa con la ancla de borde 2026-11-20 (TC-IDENTITY-DEMO-025).
- Spec: 1 requirement MODIFIED en `identity/demo-data` (scenario nuevo).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `identity/demo-data`: el requisito de contenido determinista suma el scenario de la ancla de fin de mes (1 MODIFIED, Must).

## Impact

**Specs:** `identity/demo-data` (1 MODIFIED). **Componentes:** `apps/api` (dataset del demo). **APIs, eventos, tablas y migraciones:** ninguno. **Test cases:** AÑADIDO TC-IDENTITY-DEMO-025.

**Riesgos:** con ancla `A` tal que `A − 9` o `A − 20` tengan día 29-31, las cuotas del consumo y del educativo se mueven hasta 3 días antes (y todas las cuotas posteriores del cronograma quedan en día 28); también ocurre fuera de marzo/febrero. Los estados por módulo no cambian y el golden summary con la ancla 2026-09-30 es idéntico (días 21 y 10). No hay conflicto con `add-loan-amortization-advanced`, que toca el motor de DEBT y no el dataset del demo.
