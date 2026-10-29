---
id: TC-IMPORTS-PIPELINE-051
title: "Si la ocurrencia se resolvió antes de persistir la transacción se crea sin vínculo y con advertencia"
spec: imports/import-pipeline
related_specs: ["commitments/recurrence-engine"]
requirement: "Coincidencias con compromisos confirmadas en la vista previa"
scenario: "Ocurrencia resuelta antes de persistir"
requirement_status: provisional
fr: ["FR-COMMITMENTS-010", "FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_OCCURRENCE_LINK_SKIPPED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Ocurrencia resuelta antes de persistir\" del delta de add-import-pipeline"
steps:
  - "el EDITOR confirmó el vínculo de \"TIGO INTERNET\" y, antes de persistir, la ocurrencia del \"Internet\" se aprobó creando otro gasto"
expected_result:
  - "el gasto importado de 199.00 BOB se crea sin vínculo con la advertencia `IMPORT_OCCURRENCE_LINK_SKIPPED`"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-051 — Si la ocurrencia se resolvió antes de persistir la transacción se crea sin vínculo y con advertencia

## Intención

La vista previa DEBERÍA (SHOULD) mostrar para cada fila las ocurrencias de compromisos candidatas con su puntaje y confianza, y permitir que el OWNER o EDITOR confirme el vínculo de una fila o, con una acción explícita, el de todas las filas con un único candidato de confianza alta; al persistir, cada fila confirmada DEBE (MUST) vincular su transacción a la ocurrencia con quien aprobó como actor.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR confirmó el vínculo de "TIGO INTERNET" y, antes de persistir, la ocurrencia del "Internet" se aprobó creando otro gasto
Entonces el gasto importado de 199.00 BOB se crea sin vínculo con la advertencia `IMPORT_OCCURRENCE_LINK_SKIPPED`
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
