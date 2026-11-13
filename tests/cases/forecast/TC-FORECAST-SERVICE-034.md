---
id: TC-FORECAST-SERVICE-034
title: "El servicio rechaza una petición sin la credencial de servicio"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Servicio de pronósticos autenticado y sin acceso a datos"
scenario: "Petición sin credencial"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-007","NFR-SEC-014","NFR-COMP-001"]
invariants: []
priority: critical
type: security
level: security
automation_status: automated
automated_tests:
  - services/ml-forecasting/tests/test_api.py
status: automated
regression_suite: false
phase: 8
tags: ["service-auth"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un proceso de la red interna llama al servicio sin la credencial de servicio"
expected_result:
  - "el servicio responde no autorizado sin procesar la petición"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-034 — El servicio rechaza una petición sin la credencial de servicio

## Intención

Verifica el scenario "Petición sin credencial" del requirement "Servicio de pronósticos autenticado y sin acceso a datos" de `forecast/expense-forecasting` (NFR-SEC-007, NFR-SEC-014, NFR-COMP-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un proceso de la red interna llama al servicio sin la credencial de servicio
Entonces el servicio responde no autorizado sin procesar la petición
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
