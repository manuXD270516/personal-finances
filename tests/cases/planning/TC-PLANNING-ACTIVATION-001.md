---
id: TC-PLANNING-ACTIVATION-001
title: Un periodo se activa al llegar su fecha de inicio en la zona horaria del workspace
spec: planning/financial-periods
related_specs: []
requirement: Activación automática según la zona horaria del workspace
scenario: Medianoche en La Paz
requirement_status: provisional
fr:
  - FR-PLANNING-001
  - FR-PLANNING-002
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
  - financial-periods
  - timezone
  - RISK-020
error_code: null
preconditions:
  - Workspace en America/La_Paz (UTC-4), día de inicio 1
  - '"2026-10" active, "2026-11" draft'
  - Workspace W2 en UTC con "2026-11" draft
input:
  - instant: 2026-11-01T03:30:00Z
    localTime: 2026-10-31 23:30 La Paz
  - instant: 2026-11-01T04:05:00Z
    localTime: 2026-11-01 00:05 La Paz
  - workspace: W2 (UTC)
    instant: 2026-11-01T00:05:00Z
steps:
  - Ejecutar el proceso de periodos en cada instante con el reloj fijo y TZ del proceso forzada a UTC y a America/La_Paz
expected_result:
  - A las 03:30Z "2026-11" sigue en draft
  - A las 04:05Z "2026-11" pasa a active y "2026-10" sigue active pendiente de cierre
  - En W2 (UTC) "2026-11" se activa a las 00:05Z
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-ACTIVATION-001 — Un periodo se activa al llegar su fecha de inicio en la zona horaria del workspace

## Intención

RISK-020: activar con la fecha UTC adelantaría el mes cuatro horas en Bolivia.

## Escenario

```gherkin
Dado un workspace en America/La_Paz con "2026-11" en draft
Cuando el proceso corre a las 2026-11-01T03:30Z
Entonces "2026-11" sigue en draft
Cuando el proceso corre a las 2026-11-01T04:05Z
Entonces "2026-11" pasa a active
```

## Notas

- Cubre "Workspace en UTC". Ejecutar con TZ=UTC y TZ=America/La_Paz para detectar dependencias del huso del proceso.
