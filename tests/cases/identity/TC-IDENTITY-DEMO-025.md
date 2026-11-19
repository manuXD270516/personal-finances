---
id: TC-IDENTITY-DEMO-025
title: "La demo carga READY con anclas de fin de mes y el primer periodo de cada préstamo mide 30 días"
spec: identity/demo-data
related_specs: ["debt/loans"]
requirement: "Contenido demo ficticio, realista y determinista"
scenario: "Ancla de fin de mes con la cuota en día 29 a 31"
requirement_status: confirmed
fr: ["FR-IDENTITY-014", "FR-LEDGER-001"]
nfr: []
invariants: ["INV-004", "INV-025"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/src/demo/dataset/plan-modules/loans.test.ts","apps/api/test/demo/demo-v2.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism", "month-end"]
error_code: DEMO_GOLDEN_MISMATCH
preconditions:
  - "Dataset Demo v2 y workspace demo con la ancla 2026-11-20 (America/La_Paz)"
input: {"anchor":"2026-11-20"}
steps:
  - "Barrer las anclas de 2025 a 2029 y comprobar las fechas de cada préstamo del plan"
  - "Cargar la demo con la ancla 2026-11-20 y esperar READY"
  - "Listar las cuotas del Crédito educativo"
expected_result:
  - "Para toda ancla: días 30/360 entre el desembolso y la primera cuota = 30 y día de la primera cuota <= 28"
  - "Para toda ancla: la cuota 6 del consumo y la cuota 8 del educativo vencen en o antes de la ancla y la siguiente después"
  - "La carga con la ancla 2026-11-20 termina READY, sin DEMO_GOLDEN_MISMATCH"
  - "La cuota 8 del Crédito educativo vence el 2026-10-28 y está pagada; la cuota 9 vence el 2026-11-28"
  - "Cada asiento suma 0.00 por moneda"
created: 2026-11-18
updated: 2026-11-18
---

# TC-IDENTITY-DEMO-025 — La demo carga READY con anclas de fin de mes

## Intención

La ancla es «hoy». Con `A − 9` o `A − 20` en día 29-31 el desembolso de un préstamo se recortaba a 28 de febrero y el motor de DEBT (30/360 europeo) cobraba un primer periodo de 31-32 días, distinto de los 30 del oráculo del plan: la carga terminaba `FAILED` con `DEMO_GOLDEN_MISMATCH` (2026-11-18 a 2026-11-20 y 2026-09-07 a 2026-09-09).

## Escenario

```gherkin
Dado la demo v2
Cuando la cargo con la ancla 2026-11-20
Entonces termina READY
  Y la cuota 8 del Crédito educativo vence el 2026-10-28 y está pagada
```

## Notas

- Antes de la corrección: `educativo installment 1: expected 946.19/120.00, got 938.19/128.00`; también fallaban 2026-11-18/19 y 2026-09-07/08/09 (consumo).
- El test unitario replica la fórmula 30/360 europeo de DEBT porque `apps` no importa su dominio; el contraste con el motor lo da la carga completa.
- Change: `fix-demo-loan-month-end`.
