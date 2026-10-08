---
id: TC-PLANNING-EVENT-001
title: Cada activación publica exactamente un evento PeriodActivated válido
spec: planning/financial-periods
related_specs: []
requirement: Auditoría y evento de los cambios de periodo
scenario: Activación automática auditada
requirement_status: confirmed
fr:
  - FR-AUDIT-001
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
  - financial-periods
  - events
error_code: null
preconditions:
  - '"2026-11" en draft; reloj en 2026-11-01T04:05Z'
input:
  event: planning.PeriodActivated.v1
steps:
  - Ejecutar el proceso de periodos dos veces
  - Leer el outbox
expected_result:
  - Existe un único evento planning.PeriodActivated.v1 con label "2026-11", periodStart 2026-11-01, periodEnd 2026-11-30 y activation AUTOMATIC
  - El payload valida contra contracts/events/planning/PeriodActivated.v1.schema.json
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-EVENT-001 — Cada activación publica exactamente un evento PeriodActivated válido

## Intención

Los consumidores (REPORTING, NOTIFY) dependen de un evento por activación.

## Escenario

```gherkin
Dado que "2026-11" está en draft
Cuando el proceso lo activa dos veces seguidas
Entonces el outbox contiene un único evento de periodo activado
```

## Notas

- Sin notas adicionales.
