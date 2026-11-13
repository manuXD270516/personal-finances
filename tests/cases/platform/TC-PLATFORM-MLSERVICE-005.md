---
id: TC-PLATFORM-MLSERVICE-005
title: "Una vulnerabilidad crítica en la imagen del servicio bloquea su publicación"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Imagen del servicio de pronósticos promovida por digest"
scenario: "Imagen con vulnerabilidad crítica"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-006","NFR-SEC-013","NFR-SEC-014"]
invariants: []
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 8
tags: ["trivy","supply-chain"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el escaneo de la imagen del servicio de pronósticos reporta una vulnerabilidad crítica con corrección disponible y sin excepción registrada"
expected_result:
  - "el pipeline de la rama principal falla y la imagen no se publica"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-005 — Una vulnerabilidad crítica en la imagen del servicio bloquea su publicación

## Intención

Verifica el scenario "Imagen con vulnerabilidad crítica" del requirement "Imagen del servicio de pronósticos promovida por digest" de `platform/delivery-pipeline` (NFR-PORT-006, NFR-SEC-013, NFR-SEC-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el escaneo de la imagen del servicio de pronósticos reporta una vulnerabilidad crítica con corrección disponible y sin excepción registrada
Entonces el pipeline de la rama principal falla y la imagen no se publica
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
