---
id: TC-REPORTING-UPCOMING-001
title: "La lista de 30 días incluye ocurrencias no resueltas y pendientes de egreso en orden de fecha"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Lista de próximos pagos"
scenario: "Próximos 30 días"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Ocurrencias de egreso no resueltas: \"Internet\" 199.00 BOB (2026-10-22), \"Luz\" 180.00 BOB (2026-10-28), \"Alquiler\" 2500.00 BOB (2026-11-01), \"Seguro anual\" 900.00 BOB (2026-12-15)"
  - "Transacción pendiente \"Cena\" 300.00 BOB del 2026-10-18 en \"Banco BOB\""
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "Ventana 2026-10-20 a 2026-11-19"
  - "Ítems en orden: Cena, Internet, Luz, Alquiler"
  - "Seguro anual no aparece"
  - "Total de la lista = 3179.00 BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-001 — La lista de 30 días incluye ocurrencias no resueltas y pendientes de egreso en orden de fecha

## Intención

FR-REPORTING-016: la lista simple de Q8 une ocurrencias no resueltas y pendientes de egreso de la ventana; sin esto el Home seguiría sin responder qué pagos vienen.

## Escenario

```gherkin
Dadas las ocurrencias Internet, Luz, Alquiler y Seguro anual y la pendiente Cena
Cuando consulto los próximos pagos de 30 días el 2026-10-20
Entonces veo Cena, Internet, Luz y Alquiler en ese orden
  Y el total es 3179.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
