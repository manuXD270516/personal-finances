---
id: TC-IMPORTS-PIPELINE-066
title: "Un OFX de 5 000 movimientos con 200 reglas activas llega a revisión en 30 s o menos"
spec: imports/import-pipeline
related_specs: []
requirement: "Rendimiento hasta la vista previa con el pipeline completo"
scenario: "Extracto OFX de 5 000 movimientos"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-007"]
invariants: []
priority: high
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/api/test/perf/imports.perf.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline", "nightly", "perf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Extracto OFX de 5 000 movimientos\" del delta de add-import-pipeline"
steps:
  - "un EDITOR crea una importación desde un OFX de 5 000 movimientos nuevos en un workspace con 200 reglas activas"
expected_result:
  - "la importación queda \"en revisión\" en 30 segundos o menos desde su creación"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-066 — Un OFX de 5 000 movimientos con 200 reglas activas llega a revisión en 30 s o menos

## Intención

Una importación de 5 000 filas creada desde un documento DEBE (MUST) llegar a la vista previa en 30 segundos o menos en el entorno de referencia, incluyendo la lectura, la normalización, la validación, la evaluación de 200 reglas activas, los duplicados y las coincidencias con compromisos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un EDITOR crea una importación desde un OFX de 5 000 movimientos nuevos en un workspace con 200 reglas activas
Entonces la importación queda "en revisión" en 30 segundos o menos desde su creación
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
