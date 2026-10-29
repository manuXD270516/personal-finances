---
id: TC-IMPORTS-PIPELINE-029
title: "El perfil de la institución cuyas columnas coinciden se aplica sin pasar por el mapeo"
spec: imports/import-pipeline
related_specs: []
requirement: "Aplicación automática del perfil de la institución"
scenario: "Perfil de la institución aplicado"
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
input: "Datos del scenario \"Perfil de la institución aplicado\" del delta de add-import-pipeline"
steps:
  - "\"Banco BOB\" es de \"Banco Cumbre Demo\", el perfil \"Cumbre caja de ahorro CSV\" versión 2 espera \"Fecha\", \"Descripción\" y \"Monto\", y el extracto trae esas columnas"
expected_result:
  - "la importación queda en revisión con ese perfil en su versión 2, sin pasar por el mapeo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-029 — El perfil de la institución cuyas columnas coinciden se aplica sin pasar por el mapeo

## Intención

Al procesar una importación, el sistema DEBE (MUST) buscar el perfil vigente de la cuenta destino y, si no hay, los de su institución, del mismo formato, y aplicar automáticamente el primero cuyas columnas obligatorias existen en el encabezado del archivo (sin distinguir mayúsculas ni acentos), dejando la importación en revisión con el perfil y la versión aplicados; si ninguno coincide, la importación DEBE (MUST) quedar esperando mapeo con los perfiles candidatos y las columnas que faltan.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando "Banco BOB" es de "Banco Cumbre Demo", el perfil "Cumbre caja de ahorro CSV" versión 2 espera "Fecha", "Descripción" y "Monto", y el extracto trae esas columnas
Entonces la importación queda en revisión con ese perfil en su versión 2, sin pasar por el mapeo
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
