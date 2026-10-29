---
id: TC-IMPORTS-PIPELINE-048
title: "Una coincidencia confirmada en la vista previa vincula la ocurrencia con la transacción importada"
spec: imports/import-pipeline
related_specs: ["commitments/recurrence-engine"]
requirement: "Coincidencias con compromisos confirmadas en la vista previa"
scenario: "Internet confirmado en la vista previa"
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
  - "Definición recurrente \"Internet\" de 199.00 BOB con ocurrencia pendiente del 2026-10-20 en \"Banco BOB\""
input: "Datos del scenario \"Internet confirmado en la vista previa\" del delta de add-import-pipeline"
steps:
  - "la fila \"TIGO INTERNET\" de 199.00 BOB de salida de \"Banco BOB\" del 2026-10-20 tiene como candidata la ocurrencia del \"Internet\" de ese día con confianza alta, el EDITOR confirma el vínculo y aprueba"
expected_result:
  - "se crea el gasto de 199.00 BOB y la ocurrencia queda vinculada a él por el EDITOR"
  - "la ocurrencia sale del total comprometido de octubre"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-048 — Una coincidencia confirmada en la vista previa vincula la ocurrencia con la transacción importada

## Intención

La vista previa DEBERÍA (SHOULD) mostrar para cada fila las ocurrencias de compromisos candidatas con su puntaje y confianza, y permitir que el OWNER o EDITOR confirme el vínculo de una fila o, con una acción explícita, el de todas las filas con un único candidato de confianza alta; al persistir, cada fila confirmada DEBE (MUST) vincular su transacción a la ocurrencia con quien aprobó como actor.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
  Y Definición recurrente "Internet" de 199.00 BOB con ocurrencia pendiente del 2026-10-20 en "Banco BOB"
Cuando la fila "TIGO INTERNET" de 199.00 BOB de salida de "Banco BOB" del 2026-10-20 tiene como candidata la ocurrencia del "Internet" de ese día con confianza alta, el EDITOR confirma el vínculo y aprueba
Entonces se crea el gasto de 199.00 BOB y la ocurrencia queda vinculada a él por el EDITOR
  Y la ocurrencia sale del total comprometido de octubre
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
