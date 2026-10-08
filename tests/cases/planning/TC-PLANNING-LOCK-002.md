---
id: TC-PLANNING-LOCK-002
title: Un cierre concurrente con un posteo nunca deja asientos del periodo fuera del snapshot
spec: planning/month-closing
related_specs:
  - ledger/journal-posting
requirement: Bloqueo del ledger en periodos cerrados
scenario: Cierre concurrente con un posteo
requirement_status: confirmed
fr:
  - FR-PLANNING-005
  - FR-LEDGER-011
nfr: []
invariants:
  - INV-015
  - INV-022
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - month-closing
  - concurrency
error_code: null
preconditions:
  - '"2026-10" terminado sin observaciones'
  - PostgreSQL real; dos conexiones pf_app
input:
  expense:
    amount: "30.00"
    currency: BOB
    date: 2026-10-31
  repetitions: 50
steps:
  - En paralelo, postear el gasto y cerrar "2026-10" (repetir con distintos órdenes de llegada)
expected_result:
  - "En cada repetición: o el gasto existe y el snapshot lo incluye, o el gasto se rechazó con PERIOD_CLOSED"
  - Nunca existe un asiento con fecha en "2026-10" no reflejado en el snapshot vigente (saldos del snapshot = suma de postings a 2026-10-31)
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-LOCK-002 — Un cierre concurrente con un posteo nunca deja asientos del periodo fuera del snapshot

## Intención

Cierra la carrera cerrar mes contra postear (docs/09 §10) con el candado consultivo exclusivo/compartido.

## Escenario

```gherkin
Dado que "2026-10" está terminado y sin observaciones
Cuando un gasto de 30.00 BOB del 2026-10-31 se postea a la vez que se cierra "2026-10"
Entonces o el snapshot incluye el gasto o el gasto se rechaza con "PERIOD_CLOSED"
```

## Notas

- Sin notas adicionales.
