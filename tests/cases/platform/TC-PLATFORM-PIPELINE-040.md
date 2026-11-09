---
id: TC-PLATFORM-PIPELINE-040
title: "El worker del benchmark arranca sin pasadas de la vigilancia del flujo de caja ni del digest y publica 0 trabajos programados"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import mide sin trabajos programados ajenos"
scenario: "Arranque sin pasadas ajenas"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["nightly", "perf", "imports", "stabilize-import-persist-perf"]
error_code: null
preconditions:
  - "Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"configuration":"host","startup_passes_expected":0}
steps:
  - "Arrancar el worker del benchmark con la configuración del host"
  - "Contar las pasadas de arranque encoladas de la vigilancia del flujo de caja y del digest, y los trabajos programados iniciados en la ventana"
expected_result:
  - "No se encola ninguna pasada de arranque de la vigilancia del flujo de caja ni del digest del Home"
  - "El reporte publica 0 trabajos programados dentro de la ventana medida"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-040 — El worker del benchmark arranca sin pasadas de la vigilancia del flujo de caja ni del digest y publica 0 trabajos programados

## Intención

Requirement «El benchmark del import mide sin trabajos programados ajenos» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando el benchmark arranca el worker con la configuración del host
Entonces no se encola ninguna pasada de arranque de la vigilancia del flujo de caja ni del digest del Home
  Y el reporte publica 0 trabajos programados dentro de la ventana medida
```

## Notas

- Hipótesis H2 del design: #216 (`add-cash-flow-forecast`) registra la vigilancia con pasada de arranque en el worker del harness.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
