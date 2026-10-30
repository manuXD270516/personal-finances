---
id: TC-IMPORTS-PIPELINE-010
title: "Cancelar una importación en procesamiento la deja cancelada sin filas ni transacciones"
spec: imports/import-pipeline
related_specs: []
requirement: "Etapas del import en el worker, reanudables"
scenario: "Cancelar durante el procesamiento"
requirement_status: provisional
fr: ["FR-IMPORTS-001", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/domain/import-job.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Cancelar durante el procesamiento\" del delta de add-import-pipeline"
steps:
  - "el usuario cancela una importación \"procesando\""
expected_result:
  - "la importación queda cancelada, sin filas y sin transacciones"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-010 — Cancelar una importación en procesamiento la deja cancelada sin filas ni transacciones

## Intención

El procesamiento de una importación creada desde un documento DEBE (MUST) correr fuera de la petición, en etapas —lectura, normalización, validación, clasificación, duplicados y coincidencias con compromisos— y DEBE (MUST) informar el estado ("subida", "procesando" con la etapa y las filas procesadas, "esperando mapeo", "en revisión" o "falló la lectura").

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el usuario cancela una importación "procesando"
Entonces la importación queda cancelada, sin filas y sin transacciones
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
