---
id: TC-PLATFORM-PIPELINE-041
title: "Una vigilancia horaria de 4 200 ms durante la persistencia se publica con inicio y duración y la fila no se repite"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import mide sin trabajos programados ajenos"
scenario: "Trabajo horario dentro de la ventana"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007"]
invariants: []
priority: low
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
input: {"scheduled_job":"vigilancia horaria del flujo de caja","duration_ms":4200}
steps:
  - "Publicar la fila con un trabajo programado iniciado dentro de la ventana de la persistencia"
expected_result:
  - "El reporte publica ese trabajo con su inicio y su duración junto a la fila del import"
  - "La fila decide su veredicto con la persistencia medida, sin repetirse"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-041 — Una vigilancia horaria de 4 200 ms durante la persistencia se publica con inicio y duración y la fila no se repite

## Intención

Requirement «El benchmark del import mide sin trabajos programados ajenos» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la vigilancia horaria del flujo de caja corre durante la persistencia y tarda 4 200 ms
Entonces el reporte publica ese trabajo con su inicio y su duración junto a la fila del import
  Y la fila decide su veredicto con la persistencia medida, sin repetirse
```

## Notas

- En producción el cron sigue activo; el benchmark lo publica si coincide con la ventana.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
