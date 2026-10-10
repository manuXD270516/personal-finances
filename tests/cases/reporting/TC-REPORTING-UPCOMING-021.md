---
id: TC-REPORTING-UPCOMING-021
title: "Un pago resuelto por una ocurrencia generada después de pagarlo cuenta como pago sorpresa"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Indicador de pagos sorpresa por periodo"
scenario: "Seguro modelado después de pagarlo"
requirement_status: confirmed
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/upcoming-payments.api.test.ts
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/surprise-payments.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["SM-07","surprise-payments"]
error_code: null
preconditions:
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo 2026-10 en curso)"
  - "Gasto posteado \"Seguro auto\" 350.00 BOB del 2026-10-05 vinculado a la ocurrencia del 2026-10-05 de una definición creada el 2026-10-12 (ocurrencia generada el 2026-10-12)"
  - "\"Internet\" pagado el 2026-10-22 resolviendo una ocurrencia generada el 2026-07-24"
input: {"period":"2026-10"}
steps:
  - "GET W/reports/surprise-payments?period=2026-10"
expected_result:
  - "count = 1: Seguro auto 350.00 BOB del 2026-10-05"
  - "Internet no cuenta"
  - "partial = true"
  - "note UNLINKED_PAYMENTS_NOT_DETECTED"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-021 — Un pago resuelto por una ocurrencia generada después de pagarlo cuenta como pago sorpresa

## Intención

SM-07 (0 pagos recurrentes sorpresa por mes) necesita una medida objetiva: lo que no estuvo en la lista antes de pagarse fue sorpresa.

## Escenario

```gherkin
Dado Seguro auto pagado el 2026-10-05 y modelado el 2026-10-12
Cuando consulto los pagos sorpresa de 2026-10
Entonces el indicador informa 1 pago sorpresa (Seguro auto, 350.00 BOB)
  Y el periodo se marca parcial
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
