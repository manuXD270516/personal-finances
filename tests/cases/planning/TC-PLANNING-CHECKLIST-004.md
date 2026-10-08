---
id: TC-PLANNING-CHECKLIST-004
title: "Una cuenta conciliada solo sin extracto cuenta como conciliada para el cierre"
spec: planning/month-closing
related_specs: ["transactions/reconciliation"]
requirement: "Cuentas conciliadas a diferencia cero"
scenario: "Cuenta conciliada sin extracto"
requirement_status: confirmed
fr: [FR-PLANNING-003, FR-TRANSACTIONS-030]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/close-checklist.test.ts
status: automated
regression_suite: true
phase: 2
tags: ["checklist", "without-statement"]
error_code: null
preconditions:
  - "Periodo \"2026-10\" (del 2026-10-01 al 2026-10-31) ACTIVE y terminado; política de cierre por defecto"
  - "FixedClock 2026-11-03T12:00:00-04:00 (America/La_Paz)"
  - "\"Caja BOB\" sin sesiones; su único movimiento de octubre, un gasto de 80.00 BOB del 2026-10-12, conciliado sin extracto"
  - "getCoverage(from 2026-10-01, through 2026-10-31) de \"Caja BOB\": reconciledThrough true, reconciliationBasis WITHOUT_STATEMENT"
input:
  periodLabel: "2026-10"
steps:
  - "Evaluar el checklist de \"2026-10\" con CloseChecklistEvaluator"
expected_result:
  - "\"Caja BOB\" no figura en UNRECONCILED_ACCOUNTS"
  - "\"Caja BOB\" figura en el ítem RECONCILED_WITHOUT_STATEMENT (severidad INFO) con el gasto de 80.00 BOB"
created: 2026-10-08
updated: 2026-10-08
---

# TC-PLANNING-CHECKLIST-004 — Una cuenta conciliada solo sin extracto cuenta como conciliada para el cierre

## Intención

Decisión del owner docs/33 D111: las cuentas conciliadas sin extracto cuentan como conciliadas para el cierre, marcadas para revisión.

## Escenario

```gherkin
Dado "Caja BOB" con su único gasto de octubre conciliado sin extracto
Cuando se evalúa el checklist de "2026-10"
Entonces "Caja BOB" cuenta como conciliada
  Y aparece como "conciliada sin extracto — pendiente de revisión"
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
