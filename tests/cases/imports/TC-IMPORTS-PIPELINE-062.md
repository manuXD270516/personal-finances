---
id: TC-IMPORTS-PIPELINE-062
title: "Reimportar después de deshacer vuelve a crear las 3 transacciones"
spec: imports/import-pipeline
related_specs: []
requirement: "Deshacer un import"
scenario: "Reimportar después de deshacer"
requirement_status: provisional
fr: ["FR-IMPORTS-012", "FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-014"]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.lifecycle.test.ts
  - tests/e2e/specs/import-pipeline.spec.ts
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
input: "Datos del scenario \"Reimportar después de deshacer\" del delta de add-import-pipeline"
steps:
  - "la importación se deshizo por completo y el usuario vuelve a importar el mismo archivo"
expected_result:
  - "las 3 filas son nuevas y al aprobar se crean 3 transacciones"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-062 — Reimportar después de deshacer vuelve a crear las 3 transacciones

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder deshacer una importación terminada: el sistema DEBE (MUST) mostrar antes cuántas transacciones se anularán y cuáles están bloqueadas, y al confirmar DEBE (MUST) anular con su reversa cada transacción no anulada que la importación creó, sin borrar nada, con auditoría y de forma idempotente.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la importación se deshizo por completo y el usuario vuelve a importar el mismo archivo
Entonces las 3 filas son nuevas y al aprobar se crean 3 transacciones
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
