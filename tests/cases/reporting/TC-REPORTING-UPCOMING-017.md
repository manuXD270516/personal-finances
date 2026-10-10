---
id: TC-REPORTING-UPCOMING-017
title: "La tarjeta Q8 muestra hasta 5 pagos de los próximos 7 días e indica cuántos más hay"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Preguntas Q4 y Q8 habilitadas en el Home"
scenario: "Seis pagos en la semana"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-REPORTING-001","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - tests/e2e/specs/upcoming-payments.spec.ts
status: automated
regression_suite: false
phase: 3
tags: ["home","q8"]
error_code: null
preconditions:
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Pagos de los próximos 7 días: Netflix (vencido 2026-10-15), Cena (pendiente 2026-10-18), Internet (2026-10-22), Spotify (2026-10-25), Luz (2026-10-26), Agua (2026-10-27)"
input: {"days":7}
steps:
  - "Abrir el Home"
expected_result:
  - "La tarjeta Q8 lista Netflix, Cena, Internet, Spotify y Luz"
  - "Indica 1 pago más con enlace a /pagos-proximos"
  - "La tarjeta Q4 muestra el total comprometido del periodo"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-017 — La tarjeta Q8 muestra hasta 5 pagos de los próximos 7 días e indica cuántos más hay

## Intención

D104: tarjeta compacta en el Home con enlace a la vista completa; lo vencido y lo pendiente primero.

## Escenario

```gherkin
Dados seis pagos en los próximos 7 días
Cuando abro el Home
Entonces la tarjeta Q8 muestra cinco e indica 1 más con enlace a la lista completa
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
