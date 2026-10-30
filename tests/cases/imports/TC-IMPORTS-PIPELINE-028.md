---
id: TC-IMPORTS-PIPELINE-028
title: "Un perfil archivado no se sugiere ni se aplica a importaciones nuevas"
spec: imports/import-pipeline
related_specs: []
requirement: "Perfiles de mapeo por institución, versionados"
scenario: "Perfil archivado"
requirement_status: provisional
fr: ["FR-IMPORTS-005"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/domain/mapping-profile.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.test.ts
  - packages/contexts/imports/test/integration/pg-pipeline.int.test.ts
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
input: "Datos del scenario \"Perfil archivado\" del delta de add-import-pipeline"
steps:
  - "el EDITOR archiva el perfil \"Cumbre caja de ahorro CSV\" y luego importa un extracto de \"Banco BOB\""
expected_result:
  - "ese perfil no se sugiere ni se aplica"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-028 — Un perfil archivado no se sugiere ni se aplica a importaciones nuevas

## Intención

Un OWNER o EDITOR DEBE (MUST) poder guardar un mapeo como perfil con nombre, formato, la institución del workspace a la que aplica y opcionalmente una cuenta, con sus opciones de lectura; editar un perfil DEBE (MUST) crear una versión nueva sin modificar las anteriores, y cada importación DEBE (MUST) conservar el perfil y la versión con que se procesó.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR archiva el perfil "Cumbre caja de ahorro CSV" y luego importa un extracto de "Banco BOB"
Entonces ese perfil no se sugiere ni se aplica
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
