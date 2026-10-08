---
id: TC-NOTIFICATIONS-EMAIL-001
title: 'El email por defecto no contiene montos, categorías ni moneda'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Emails sin montos salvo opt-in explícito'
scenario: 'Email sin detalles por defecto'
requirement_status: confirmed
fr: ['FR-NOTIFY-006']
nfr: ['NFR-COMP-001']
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['notifications', 'email', 'privacy', 'mailpit']
error_code: null
preconditions:
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'EMAIL_DRIVER=smtp contra Mailpit (Testcontainers)'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento y despachar el email'
  - 'Leer el mensaje desde la API de Mailpit (asunto, texto y HTML)'
expected_result:
  - 'El email dice que una línea del presupuesto de "2026-11" alcanzó el 90 %'
  - 'Ni asunto ni cuerpos contienen "Restaurantes", "550", "600" ni "BOB"'
  - 'El in-app sí muestra los detalles'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-EMAIL-001 — El email por defecto no contiene montos, categorías ni moneda

## Intención

FR-NOTIFY-006 y docs/12 §13.3: el email es un canal menos controlado que la app.

## Escenario

```gherkin
Dado el OWNER sin opt-in de detalles
Cuando recibe el email del umbral 90 % de "Restaurantes"
Entonces el email no contiene "Restaurantes", "550.00", "600.00" ni "BOB"
```

## Notas

- Lista de términos prohibidos compartida con el test de catálogo de plantillas.
