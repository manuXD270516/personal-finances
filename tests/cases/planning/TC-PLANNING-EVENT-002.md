---
id: TC-PLANNING-EVENT-002
title: Cada cierre publica un evento MonthClosed con su versión y ninguno si se rechaza
spec: planning/month-closing
related_specs: []
requirement: Eventos de cierre y reapertura
scenario: Cierre rechazado sin evento
requirement_status: provisional
fr:
  - FR-PLANNING-004
nfr:
  - NFR-REL-008
invariants:
  - INV-028
priority: high
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - events
error_code: null
preconditions:
  - '"2026-10" terminado'
input:
  - close: rechazado con MONTH_CLOSING_BLOCKED
  - close: aceptado (versión 1)
steps:
  - Intentar cerrar con un pendiente
  - Resolver el pendiente y cerrar
  - Leer el outbox
expected_result:
  - El cierre rechazado no publica evento
  - El cierre aceptado publica un único planning.MonthClosed.v1 con closeNo 1, rango y totales con montos como string decimal
  - El payload valida contra contracts/events/planning/MonthClosed.v1.schema.json
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-EVENT-002 — Cada cierre publica un evento MonthClosed con su versión y ninguno si se rechaza

## Intención

REPORTING y los consumidores opcionales (NOTIFY, evolución del patrimonio) dependen de un evento por cierre aceptado.

## Escenario

```gherkin
Dado que un cierre de "2026-10" se rechaza con "MONTH_CLOSING_BLOCKED"
Entonces no se publica ningún evento de mes cerrado
```

## Notas

- Sin notas adicionales.
