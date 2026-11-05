---
id: TC-NOTIFICATIONS-DIGEST-002
title: "El lunes a las 08:00 cada miembro con digest semanal recibe el resumen de Q1 a Q9 fuera del centro de notificaciones"
spec: notifications/alerts
related_specs: []
requirement: "Digest periódico del Home por email"
scenario: "Digest semanal del lunes"
requirement_status: provisional
fr: ["FR-NOTIFY-007","FR-REPORTING-001"]
nfr: []
invariants: []
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["notifications","digest"]
error_code: null
preconditions:
  - "OWNER y VIEWER de \"W1\" con digest semanal; EDITOR sin digest"
  - "FixedClock en 2026-11-02T08:05:00-04:00"
  - "Mailpit de Testcontainers"
input: {"job":"notifications.digest"}
steps:
  - "Correr el job del digest"
  - "Listar el centro de notificaciones de cada uno"
expected_result:
  - "OWNER y VIEWER reciben un email con Q1–Q9 de \"W1\"; el EDITOR ninguno"
  - "El digest no aparece en el centro ni en el contador"
created: 2026-11-04
updated: 2026-11-04
---

# TC-NOTIFICATIONS-DIGEST-002 — El lunes a las 08:00 cada miembro con digest semanal recibe el resumen de Q1 a Q9 fuera del centro de notificaciones

## Intención

FR-NOTIFY-007 y VIEWER incluido (lee el Home).

## Escenario

```gherkin
Dado Mailpit de Testcontainers
Cuando Correr el job del digest
Entonces OWNER y VIEWER reciben un email con Q1–Q9 de "W1"; el EDITOR ninguno
  Y El digest no aparece en el centro ni en el contador
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Digest periódico del Home por email" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
