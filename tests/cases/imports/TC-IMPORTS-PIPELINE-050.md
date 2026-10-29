---
id: TC-IMPORTS-PIPELINE-050
title: "Confirmar todas las de confianza alta vincula las 5 únicas y deja sin confirmar las ambiguas"
spec: imports/import-pipeline
related_specs: ["commitments/recurrence-engine"]
requirement: "Coincidencias con compromisos confirmadas en la vista previa"
scenario: "Confirmar todas las de confianza alta"
requirement_status: provisional
fr: ["FR-COMMITMENTS-010", "FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
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
input: "Datos del scenario \"Confirmar todas las de confianza alta\" del delta de add-import-pipeline"
steps:
  - "la vista previa tiene 5 filas con un único candidato de confianza alta y 2 filas con candidatas ambiguas, y el EDITOR confirma todas las de confianza alta"
expected_result:
  - "las 5 filas quedan con su vínculo confirmado y las 2 ambiguas sin confirmar"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-050 — Confirmar todas las de confianza alta vincula las 5 únicas y deja sin confirmar las ambiguas

## Intención

La vista previa DEBERÍA (SHOULD) mostrar para cada fila las ocurrencias de compromisos candidatas con su puntaje y confianza, y permitir que el OWNER o EDITOR confirme el vínculo de una fila o, con una acción explícita, el de todas las filas con un único candidato de confianza alta; al persistir, cada fila confirmada DEBE (MUST) vincular su transacción a la ocurrencia con quien aprobó como actor.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la vista previa tiene 5 filas con un único candidato de confianza alta y 2 filas con candidatas ambiguas, y el EDITOR confirma todas las de confianza alta
Entonces las 5 filas quedan con su vínculo confirmado y las 2 ambiguas sin confirmar
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
