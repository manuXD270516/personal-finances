---
id: TC-GOALS-SAVINGS-043
title: "Los emails de metas no incluyen montos, monedas ni nombres sin opt-in de detalles"
spec: notifications/alerts
related_specs: ["goals/savings-goals"]
requirement: "Emails de metas sin montos salvo opt-in"
scenario: "Email de sobre-asignación sin detalles"
requirement_status: provisional
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "notifications", "email", "privacy"]
error_code: null
preconditions:
  - "OWNER con email activado y sin opt-in de detalles"
  - "Mailpit local"
input: {"event": "sobre-asignación de \"Banco BOB\" con faltante 1200.00 BOB"}
steps:
  - "Procesar el hecho y despachar el email"
expected_result:
  - "El email dice que una cuenta tiene más dinero reservado que su saldo"
  - "No contiene \"Banco BOB\", \"1200.00\", \"BOB\", \"Laptop\" ni \"Fondo de emergencia\""
  - "El in-app sí muestra los detalles"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-043 — Los emails de metas no incluyen montos, monedas ni nombres sin opt-in de detalles

## Intención

FR-NOTIFY-006 / RISK-010.

## Escenario

```gherkin
Dado un OWNER sin opt-in de detalles
Cuando recibe el email de sobre-asignación de "Banco BOB"
Entonces el email no contiene montos ni nombres
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
