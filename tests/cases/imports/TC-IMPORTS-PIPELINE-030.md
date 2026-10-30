---
id: TC-IMPORTS-PIPELINE-030
title: "El perfil propio de la cuenta tiene prioridad sobre el de su institución"
spec: imports/import-pipeline
related_specs: []
requirement: "Aplicación automática del perfil de la institución"
scenario: "Perfil de la cuenta antes que el de la institución"
requirement_status: provisional
fr: ["FR-IMPORTS-005"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/domain/mapping-profile.test.ts
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
input: "Datos del scenario \"Perfil de la cuenta antes que el de la institución\" del delta de add-import-pipeline"
steps:
  - "\"Banco BOB\" tiene su propio perfil vigente y su institución tiene otro, y ambos coinciden con el encabezado"
expected_result:
  - "se aplica el perfil de la cuenta"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-030 — El perfil propio de la cuenta tiene prioridad sobre el de su institución

## Intención

Al procesar una importación, el sistema DEBE (MUST) buscar el perfil vigente de la cuenta destino y, si no hay, los de su institución, del mismo formato, y aplicar automáticamente el primero cuyas columnas obligatorias existen en el encabezado del archivo (sin distinguir mayúsculas ni acentos), dejando la importación en revisión con el perfil y la versión aplicados; si ninguno coincide, la importación DEBE (MUST) quedar esperando mapeo con los perfiles candidatos y las columnas que faltan.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando "Banco BOB" tiene su propio perfil vigente y su institución tiene otro, y ambos coinciden con el encabezado
Entonces se aplica el perfil de la cuenta
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
