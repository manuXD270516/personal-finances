---
id: TC-PLANNING-CLOSE-006
title: "El cierre con una cuenta conciliada sin extracto no se bloquea y el snapshot registra la base y las transacciones"
spec: planning/month-closing
related_specs: ["transactions/reconciliation"]
requirement: "Cuentas conciliadas sin extracto en el cierre"
scenario: "Cierre con una cuenta conciliada sin extracto"
requirement_status: confirmed
fr: [FR-PLANNING-003, FR-PLANNING-004, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-022]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ["close", "snapshot", "without-statement"]
error_code: null
preconditions:
  - "Periodo \"2026-10\" (del 2026-10-01 al 2026-10-31) ACTIVE y terminado; política de cierre por defecto"
  - "FixedClock 2026-11-03T12:00:00-04:00 (America/La_Paz)"
  - "\"Bank A\" conciliada con la sesión al 2026-10-31 por 5200.00 BOB (diferencia 0.00)"
  - "\"Caja BOB\" conciliada solo sin extracto con el gasto C1 de 80.00 BOB del 2026-10-12"
  - "Sin pendientes, duplicados ni porciones sin categoría"
input:
  acknowledgeWarnings: false
steps:
  - "GET close-checklist"
  - "POST close sin acknowledgeWarnings"
  - "GET close-snapshots/1"
expected_result:
  - "Checklist: canClose true, requiresAcknowledgement false; ítem RECONCILED_WITHOUT_STATEMENT (INFO) con \"Caja BOB\" y C1"
  - "Cierre aceptado sin reconocer advertencias; \"2026-10\" closed"
  - "Snapshot 1: \"Bank A\" reconciliationBasis STATEMENT con su sesión; \"Caja BOB\" reconciliationBasis WITHOUT_STATEMENT y reconciledWithoutStatementTransactionIds [C1]"
  - "planning.close_snapshot_without_statement tiene la fila de C1 (80.00 BOB) y rechaza UPDATE/DELETE con pf_app (PF003)"
created: 2026-10-08
updated: 2026-10-08
---

# TC-PLANNING-CLOSE-006 — El cierre con una cuenta conciliada sin extracto no se bloquea y el snapshot registra la base y las transacciones

## Intención

Decisión del owner docs/33 D111: cuenta como conciliada pero queda marcada en el checklist (sin bloquear) y registrada en el snapshot inmutable.

## Escenario

```gherkin
Dado "Bank A" conciliada contra extracto y "Caja BOB" conciliada solo sin extracto
Cuando el EDITOR cierra "2026-10"
Entonces el cierre se acepta sin reconocimiento
  Y el snapshot registra la base de cada cuenta y el gasto de 80.00 BOB sin extracto
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
