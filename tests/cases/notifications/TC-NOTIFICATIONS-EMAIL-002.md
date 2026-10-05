---
id: TC-NOTIFICATIONS-EMAIL-002
title: 'Con opt-in de detalles el email incluye categoría y montos'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Emails sin montos salvo opt-in explícito'
scenario: 'Email con detalles por opt-in'
requirement_status: provisional
fr: ['FR-NOTIFY-006']
nfr: []
invariants: []
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'email', 'opt-in']
error_code: null
preconditions:
  - 'OWNER con includeDetailsInEmail = true'
  - 'Mailpit'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento y despachar el email'
expected_result:
  - 'El email indica "Restaurantes", 90 % y 550,00 de 600,00 BOB en formato es-BO'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-EMAIL-002 — Con opt-in de detalles el email incluye categoría y montos

## Intención

FR-NOTIFY-006: montos solo con opt-in explícito.

## Escenario

```gherkin
Dado el OWNER con opt-in de detalles
Cuando recibe el email del umbral 90 %
Entonces el email indica "Restaurantes", 90 % y 550.00 de 600.00 BOB
```

## Notas

- Formato de montos según locale (NFR-USAB-002), sin float.
