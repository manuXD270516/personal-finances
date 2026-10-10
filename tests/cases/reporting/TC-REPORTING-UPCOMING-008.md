---
id: TC-REPORTING-UPCOMING-008
title: "Al postear la pendiente de una ocurrencia el ítem deja la lista"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Ocurrencia registrada como pendiente sin doble conteo"
scenario: "Pendiente posteada"
requirement_status: confirmed
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 salvo indicación"
  - "Cuenta \"Banco BOB\" (ASSET, líquida) con saldo contable 4000.00 BOB"
  - "Ocurrencias informadas por Commitments (doble de `UpcomingCommitmentsPort`)"
input: {"days":30}
steps:
  - "Postear el gasto pendiente de \"Luz\" del TC-REPORTING-UPCOMING-007"
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "\"Luz\" no aparece"
  - "Total = 2999.00 BOB"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-008 — Al postear la pendiente de una ocurrencia el ítem deja la lista

## Intención

Un pago ya registrado en el ledger deja de estar comprometido.

## Escenario

```gherkin
Dado el estado del TC-REPORTING-UPCOMING-007
Cuando posteo el gasto pendiente de Luz
Entonces Luz ya no aparece y el total es 2999.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
