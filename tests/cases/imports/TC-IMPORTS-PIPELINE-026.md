---
id: TC-IMPORTS-PIPELINE-026
title: "Editar un perfil crea una versión nueva y la importación anterior conserva la versión usada"
spec: imports/import-pipeline
related_specs: []
requirement: "Perfiles de mapeo por institución, versionados"
scenario: "Editar crea una versión"
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
input: "Datos del scenario \"Editar crea una versión\" del delta de add-import-pipeline"
steps:
  - "una importación completada usó la versión 1 del perfil y el EDITOR cambia el formato de fecha del perfil"
expected_result:
  - "el perfil queda en su versión 2"
  - "la importación completada sigue mostrando la versión 1 con su formato de fecha original"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-026 — Editar un perfil crea una versión nueva y la importación anterior conserva la versión usada

## Intención

Un OWNER o EDITOR DEBE (MUST) poder guardar un mapeo como perfil con nombre, formato, la institución del workspace a la que aplica y opcionalmente una cuenta, con sus opciones de lectura; editar un perfil DEBE (MUST) crear una versión nueva sin modificar las anteriores, y cada importación DEBE (MUST) conservar el perfil y la versión con que se procesó.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando una importación completada usó la versión 1 del perfil y el EDITOR cambia el formato de fecha del perfil
Entonces el perfil queda en su versión 2
  Y la importación completada sigue mostrando la versión 1 con su formato de fecha original
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
