---
id: TC-IMPORTS-PIPELINE-068
title: "Un CSV de 51 columnas falla la lectura con IMPORT_UNSUPPORTED_FORMAT sin filas"
spec: imports/import-pipeline
related_specs: []
requirement: "Límites del archivo importado desde un documento"
scenario: "Demasiadas columnas"
requirement_status: provisional
fr: ["FR-IMPORTS-002"]
nfr: ["NFR-SEC-012"]
invariants: []
priority: high
type: security
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/readers/ofx-reader.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_UNSUPPORTED_FORMAT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Demasiadas columnas\" del delta de add-import-pipeline"
steps:
  - "un EDITOR importa un CSV de 51 columnas"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_UNSUPPORTED_FORMAT` y sin filas"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-068 — Un CSV de 51 columnas falla la lectura con IMPORT_UNSUPPORTED_FORMAT sin filas

## Intención

El procesamiento de un documento NO DEBE (MUST NOT) admitir más filas de datos que el máximo configurado (por defecto 5 000) ni más de 50 columnas: al excederlos, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_TOO_MANY_ROWS` o `IMPORT_UNSUPPORTED_FORMAT`, sin filas, y DEBE (MUST) detener la lectura al alcanzar el límite sin cargar el resto del archivo.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un EDITOR importa un CSV de 51 columnas
Entonces la importación queda en "falló la lectura" con `IMPORT_UNSUPPORTED_FORMAT` y sin filas
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
