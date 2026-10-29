---
id: TC-IMPORTS-PIPELINE-025
title: "Guardar un mapeo como perfil crea la versión 1 para la institución de la cuenta"
spec: imports/import-pipeline
related_specs: []
requirement: "Perfiles de mapeo por institución, versionados"
scenario: "Guardar el mapeo como perfil"
requirement_status: provisional
fr: ["FR-IMPORTS-005"]
nfr: []
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
input: "Datos del scenario \"Guardar el mapeo como perfil\" del delta de add-import-pipeline"
steps:
  - "tras mapear \"extracto-octubre.csv\" de \"Banco BOB\", cuya institución es \"Banco Cumbre Demo\", el EDITOR guarda el mapeo como el perfil \"Cumbre caja de ahorro CSV\""
expected_result:
  - "existe ese perfil en su versión 1 para \"Banco Cumbre Demo\" con formato CSV y las columnas, el formato de fecha y el separador decimal del mapeo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-025 — Guardar un mapeo como perfil crea la versión 1 para la institución de la cuenta

## Intención

Un OWNER o EDITOR DEBE (MUST) poder guardar un mapeo como perfil con nombre, formato, la institución del workspace a la que aplica y opcionalmente una cuenta, con sus opciones de lectura; editar un perfil DEBE (MUST) crear una versión nueva sin modificar las anteriores, y cada importación DEBE (MUST) conservar el perfil y la versión con que se procesó.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando tras mapear "extracto-octubre.csv" de "Banco BOB", cuya institución es "Banco Cumbre Demo", el EDITOR guarda el mapeo como el perfil "Cumbre caja de ahorro CSV"
Entonces existe ese perfil en su versión 1 para "Banco Cumbre Demo" con formato CSV y las columnas, el formato de fecha y el separador decimal del mapeo
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
