---
id: TC-REPORTING-UPCOMING-002
title: "Las ocurrencias aprobadas con transacción posteada y las omitidas no se listan"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Lista de próximos pagos"
scenario: "Ocurrencias resueltas excluidas"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
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
  - "Aprobar \"Internet\" (transacción posteada) y omitir \"Agua\" (2026-10-27)"
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "Ítems: Cena, Luz, Alquiler"
  - "Total = 2980.00 BOB"
  - "Internet y Agua no aparecen"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-002 — Las ocurrencias aprobadas con transacción posteada y las omitidas no se listan

## Intención

Una ocurrencia resuelta (materializada, vinculada, omitida o cancelada) ya no es un pago que viene; listarla inflaría Q8.

## Escenario

```gherkin
Dada la lista del TC-REPORTING-UPCOMING-001
  Y Internet aprobada con su transacción posteada y Agua omitida
Cuando consulto los próximos pagos de 30 días
Entonces la lista contiene Cena, Luz y Alquiler por 2980.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
