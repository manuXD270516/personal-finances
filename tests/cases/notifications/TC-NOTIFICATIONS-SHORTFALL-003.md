---
id: TC-NOTIFICATIONS-SHORTFALL-003
title: "El email de riesgo de déficit no muestra montos ni cuentas sin opt-in y los muestra con opt-in"
spec: notifications/alerts
related_specs: []
requirement: "Emails de riesgo de déficit sin montos salvo opt-in"
scenario: "Email sin opt-in"
requirement_status: confirmed
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: automated
automated_tests:
  - apps/api/test/events/cash-flow-notifications.int.test.ts
  - apps/api/test/events/cash-flow-watch.int.test.ts
  - packages/contexts/notifications/src/domain/cash-flow-notifications.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","shortfall","email","privacy"]
error_code: null
preconditions:
  - "Mailpit de Testcontainers"
  - "OWNER con email activado y locale es-BO"
input: {}
steps:
  - "Entregar el riesgo sin opt-in"
  - "Activar el opt-in y entregar otro episodio"
expected_result:
  - "Email con BOB, 01/11/2026 y enlace; sin −679.00, 1500.00 ni \"Banco BOB\""
  - "Con opt-in: −679.00 BOB y umbral 1500.00 BOB"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-SHORTFALL-003 — El email de riesgo de déficit no muestra montos ni cuentas sin opt-in y los muestra con opt-in

## Intención

FR-NOTIFY-006 y RISK-010.

## Escenario

```gherkin
Dado OWNER con email activado y locale es-BO
Cuando Entregar el riesgo sin opt-in
Entonces Email con BOB, 01/11/2026 y enlace; sin −679.00, 1500.00 ni "Banco BOB"
  Y Con opt-in: −679.00 BOB y umbral 1500.00 BOB
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Emails de riesgo de déficit sin montos salvo opt-in" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
