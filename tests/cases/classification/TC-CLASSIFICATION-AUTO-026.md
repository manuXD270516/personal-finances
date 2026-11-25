---
id: TC-CLASSIFICATION-AUTO-026
title: "Las sugerencias no llevan un import de 5000 filas por encima de 30 s"
spec: classification/auto-classification
related_specs: []
requirement: "Rendimiento de las sugerencias"
scenario: "Import de 5000 filas"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014"]
nfr: ["NFR-PERF-007"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions","perf"]
error_code: null
preconditions:
  - "Workspace con 5000 transacciones de historial clasificadas por el usuario y sin reglas que clasifiquen"
  - "Benchmark del nightly con timeout explícito"
input: {}
steps:
  - "se importa un CSV de 5000 filas"
  - "se mide además la consulta del alta manual con la caché caliente y fría"
expected_result:
  - "la importación llega a la vista previa en a lo sumo 30 s con las sugerencias calculadas"
  - "la consulta responde en a lo sumo 150 ms p95 con caché y 400 ms p95 sin caché"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-026 — Las sugerencias no llevan un import de 5000 filas por encima de 30 s

## Intención

Verifica el scenario "Import de 5000 filas" del requirement "Rendimiento de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace con 5000 transacciones de historial clasificadas por el usuario y sin reglas que clasifiquen
Cuando se importa un CSV de 5000 filas
Y se mide además la consulta del alta manual con la caché caliente y fría
Entonces la importación llega a la vista previa en a lo sumo 30 s con las sugerencias calculadas
Y la consulta responde en a lo sumo 150 ms p95 con caché y 400 ms p95 sin caché
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
