# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 Delta de `identity/demo-data` (1 MODIFIED) y TC-IDENTITY-DEMO-025 — 2026-11-18

## 2. PRUEBAS primero (rojo)

- [x] 2.1 `[TC-IDENTITY-DEMO-025]` barrido de anclas en `loans.test.ts` — 2026-11-18: rojo previo (272 combinaciones fecha/préstamo con periodo distinto de 30 días o día > 28)
- [x] 2.2 `[TC-IDENTITY-DEMO-025]` carga completa con la ancla 2026-11-20 en `demo-v2.int.test.ts` — 2026-11-18: rojo previo en `main` (`educativo installment 1: expected 946.19/120.00, got 938.19/128.00`)

## 3. IMPLEMENTACIÓN

- [x] 3.1 `loans.ts`: `cap28` en `consumoDue6` y `educativoDue8`; `cards.ts`: `k0` derivado de K2 — 2026-11-18

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 Gates: format, typecheck, lint, test, arch:check, traceability:check, spec:validate y la integración de `demo-v2` — 2026-11-18: ver el informe de cierre
