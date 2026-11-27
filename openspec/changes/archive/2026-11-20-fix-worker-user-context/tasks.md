# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 Delta de `security/access-control` (1 ADDED) y TC-SECURITY-RLS-019 — 2026-11-13

## 2. PRUEBAS primero (rojo)

- [x] 2.1 `[TC-SECURITY-RLS-019]` en `apps/api/test/demo/demo-worker-context.int.test.ts` — 2026-11-13: rojo previo en `main`: `expected 8 to be 0` (entregas del consumidor con `PF002`) y `expected 1 to be 0` (fallos del job)

## 3. IMPLEMENTACIÓN

- [x] 3.1 `identity-wiring.ts`: FX y `valuation.workspaces` de ACCOUNTS usan `actorSettings` — 2026-11-13: sin migración; las dos pruebas en verde

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 Gates: format, typecheck, lint, test, arch:check, traceability:check, spec:validate y `pnpm test:integration` — 2026-11-13: ver el informe de cierre
