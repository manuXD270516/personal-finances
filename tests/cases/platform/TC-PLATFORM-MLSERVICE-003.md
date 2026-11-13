---
id: TC-PLATFORM-MLSERVICE-003
title: "Un contrato interno desalineado bloquea la pull request"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Gate del servicio de pronósticos en el pull request"
scenario: "Contrato desalineado"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-MAINT-001","NFR-SEC-013"]
invariants: []
priority: high
type: platform
level: contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["ci","contract"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "una pull request agrega un campo obligatorio a la respuesta del servicio sin actualizar el contrato publicado"
expected_result:
  - "falla la verificación del contrato y la pull request no puede fusionarse"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-003 — Un contrato interno desalineado bloquea la pull request

## Intención

Verifica el scenario "Contrato desalineado" del requirement "Gate del servicio de pronósticos en el pull request" de `platform/delivery-pipeline` (NFR-MAINT-001, NFR-SEC-013, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando una pull request agrega un campo obligatorio a la respuesta del servicio sin actualizar el contrato publicado
Entonces falla la verificación del contrato y la pull request no puede fusionarse
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
