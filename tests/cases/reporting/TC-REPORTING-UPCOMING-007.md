---
id: TC-REPORTING-UPCOMING-007
title: "Una ocurrencia materializada como pendiente se cuenta una sola vez con su monto real"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Ocurrencia registrada como pendiente sin doble conteo"
scenario: "Luz creada como pendiente"
requirement_status: confirmed
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016"]
nfr: []
invariants: []
priority: critical
type: property
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "\"Luz\" ESTIMATED 180.00 BOB materializada como gasto pendiente de 185.40 BOB (externalRef commitments.occurrence)"
  - "\"Cena\" pendiente 300.00 BOB, \"Internet\" 199.00 BOB y \"Alquiler\" 2500.00 BOB no resueltas"
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "\"Luz\" aparece una sola vez, como transacción pendiente de 185.40 BOB del compromiso \"Luz\""
  - "Total = 3184.40 BOB"
  - "PBT: para cualquier combinación de ocurrencias y pendientes, cada occurrenceId aparece a lo sumo una vez"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-007 — Una ocurrencia materializada como pendiente se cuenta una sola vez con su monto real

## Intención

Q4 = ocurrencias no resueltas + pendientes: si una ocurrencia ya se registró como pendiente, contarla dos veces infla lo comprometido.

## Escenario

```gherkin
Dada Luz materializada como gasto pendiente de 185.40 BOB
Cuando consulto los próximos pagos
Entonces Luz aparece una vez con 185.40 BOB
  Y el total es 3184.40 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
