---
id: TC-IMPORTS-PIPELINE-003
title: "La transacción creada toma la categoría que la vista previa mostró para la fila"
spec: imports/import-pipeline
related_specs: ["rules/rule-engine"]
requirement: "Aprobación y creación de las transacciones"
scenario: "Clasificación tomada de la vista previa"
requirement_status: provisional
fr: ["FR-IMPORTS-003", "FR-IMPORTS-001", "FR-IMPORTS-009"]
nfr: ["NFR-DATA-016"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
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
input: "Datos del scenario \"Clasificación tomada de la vista previa\" del delta de add-import-pipeline"
steps:
  - "la vista previa muestra la fila \"TAXI AEROPUERTO\" de 60.00 BOB de salida con la categoría \"Transporte\" que eligió el usuario y el usuario aprueba"
expected_result:
  - "se crea un gasto posteado de 60.00 BOB con la categoría \"Transporte\" y origen import"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-003 — La transacción creada toma la categoría que la vista previa mostró para la fila

## Intención

La aprobación DEBE (MUST) exigir clave de idempotencia y la versión vigente de la importación, y DEBE (MUST) rechazarse con `IMPORT_REVIEW_INCOMPLETE` y el conteo de pendientes mientras haya posibles duplicados sin decisión.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la vista previa muestra la fila "TAXI AEROPUERTO" de 60.00 BOB de salida con la categoría "Transporte" que eligió el usuario y el usuario aprueba
Entonces se crea un gasto posteado de 60.00 BOB con la categoría "Transporte" y origen import
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
