---
id: TC-PLANNING-CLOSE-005
title: Solo se cierra un periodo terminado según la fecha de hoy en La Paz
spec: planning/month-closing
related_specs: []
requirement: Cierre solo de periodos terminados en la zona horaria del workspace
scenario: Último día del mes por la noche en La Paz
requirement_status: confirmed
fr:
  - FR-PLANNING-001
nfr:
  - NFR-USAB-004
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - timezone
  - RISK-020
error_code: PERIOD_NOT_ENDED
preconditions:
  - Workspace en America/La_Paz
  - '"2026-10" active sin observaciones'
  - Reloj fijo
input:
  - instant: 2026-11-01T03:30:00Z
    localTime: 2026-10-31 23:30 La Paz
  - instant: 2026-11-01T04:10:00Z
    localTime: 2026-11-01 00:10 La Paz
steps:
  - Cerrar "2026-10" en cada instante (TZ del proceso forzada a UTC y a America/La_Paz)
expected_result:
  - A las 03:30Z se rechaza con PERIOD_NOT_ENDED
  - A las 04:10Z el cierre se acepta
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-CLOSE-005 — Solo se cierra un periodo terminado según la fecha de hoy en La Paz

## Intención

RISK-020: cerrar con la fecha UTC permitiría cerrar el mes cuatro horas antes de que termine en Bolivia.

## Escenario

```gherkin
Dado un workspace en America/La_Paz
Cuando el EDITOR intenta cerrar "2026-10" a las 2026-11-01T03:30Z
Entonces se rechaza con "PERIOD_NOT_ENDED"
```

## Notas

- Cubre "Primer minuto del mes siguiente en La Paz". Cerrar un periodo draft o closed: INVALID_STATUS_TRANSITION (TC-PLANNING-STATE-001).
