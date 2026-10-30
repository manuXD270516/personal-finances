---
id: TC-IMPORTS-PIPELINE-007
title: "La importación informa la etapa y las filas procesadas mientras se procesa en el worker"
spec: imports/import-pipeline
related_specs: []
requirement: "Etapas del import en el worker, reanudables"
scenario: "Progreso por etapa"
requirement_status: provisional
fr: ["FR-IMPORTS-001", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/web/src/ui/imports/pipeline-logic.test.ts
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/domain/import-job.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.test.ts
  - tests/e2e/specs/import-pipeline.spec.ts
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
input: "Datos del scenario \"Progreso por etapa\" del delta de add-import-pipeline"
steps:
  - "se procesa una importación de 3000 filas y el usuario consulta su estado durante la normalización"
expected_result:
  - "la importación informa \"procesando\", la etapa de normalización y la cantidad de filas procesadas"
  - "al terminar queda \"en revisión\""
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-007 — La importación informa la etapa y las filas procesadas mientras se procesa en el worker

## Intención

El procesamiento de una importación creada desde un documento DEBE (MUST) correr fuera de la petición, en etapas —lectura, normalización, validación, clasificación, duplicados y coincidencias con compromisos— y DEBE (MUST) informar el estado ("subida", "procesando" con la etapa y las filas procesadas, "esperando mapeo", "en revisión" o "falló la lectura").

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando se procesa una importación de 3000 filas y el usuario consulta su estado durante la normalización
Entonces la importación informa "procesando", la etapa de normalización y la cantidad de filas procesadas
  Y al terminar queda "en revisión"
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
