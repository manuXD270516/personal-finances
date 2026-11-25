# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 Delta de `identity/demo-data` (1 MODIFIED) y TC-IDENTITY-DEMO-026 — 2026-11-25

## 2. PRUEBAS primero (rojo)

- [x] 2.1 `[TC-IDENTITY-DEMO-026]` barrido de anclas en `goals.test.ts` — 2026-11-25: rojo previo (20 de 1096 anclas con aportes distintos de los del dominio)
- [x] 2.2 `[TC-IDENTITY-DEMO-026]` carga completa con la ancla 2026-11-25 en `demo-v2.int.test.ts` — 2026-11-25: verde con la corrección; seed-demo, demo-data y demo-v2 en verde (26 tests)

## 3. IMPLEMENTACIÓN

- [x] 3.1 `goals.ts`: `monthlyPlanDates` desde el día del plan con tope al último día del mes — 2026-11-25

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 Gates: format, typecheck, lint, test, arch:check, traceability:check, spec:validate, integración y e2e de demo y cash-flow — 2026-11-25: gates locales en verde salvo @pf/traceability#test (symlink EPERM en Windows, ajeno); la integración completa y el e2e los valida CI
