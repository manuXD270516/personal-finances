---
id: TC-AUDIT-GLOBAL-005
title: "Los rechazos repetidos se auditan una vez por minuto"
spec: audit/audit-trail
related_specs: []
requirement: "Auditoría de fallos de autorización"
scenario: "Reintentos repetidos en un minuto"
requirement_status: confirmed
fr: [FR-AUDIT-005]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["audit", "security", "rate-limit"]
error_code: null
preconditions:
  - "Usuario VIEWER \"U3\" en \"W1\""
  - "FixedClock avanzable"
input:
  attempts: 5
  windowSeconds: 30
steps:
  - "U3 repite el mismo intento 5 veces en 30 segundos"
  - "Avanzar el reloj 61 segundos y repetir una vez"
expected_result:
  - "Un solo evento de seguridad en el primer minuto"
  - "Un segundo evento tras el minuto"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-005 — Los rechazos repetidos se auditan una vez por minuto

## Intención

Evita amplificar escrituras con reintentos.

## Escenario

```gherkin
Dado un VIEWER que repite 5 veces el mismo intento en 30 segundos
Cuando se consulta la auditoría
Entonces hay un solo evento de seguridad para ese minuto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
