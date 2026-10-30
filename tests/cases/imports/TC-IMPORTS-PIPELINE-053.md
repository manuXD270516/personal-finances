---
id: TC-IMPORTS-PIPELINE-053
title: "Una referencia declarada no única no se usa como identificador y ambas filas se crean"
spec: imports/import-pipeline
related_specs: []
requirement: "Idempotencia por identificador externo"
scenario: "Referencia que el banco repite"
requirement_status: provisional
fr: ["FR-IMPORTS-010", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/application/duplicate-matching.test.ts
  - packages/contexts/imports/src/domain/statement-normalizer.test.ts
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
input: "Datos del scenario \"Referencia que el banco repite\" del delta de add-import-pipeline"
steps:
  - "el perfil declara la columna \"Nro. Doc.\" como no única y el extracto trae el interés de 12.40 BOB y su retención de 1.60 BOB con la misma referencia \"88231\""
expected_result:
  - "las dos filas son nuevas y al aprobar se crean dos transacciones"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-053 — Una referencia declarada no única no se usa como identificador y ambas filas se crean

## Intención

Cuando la fila trae un identificador externo estable —el del movimiento OFX o el de una columna de referencia declarada única en el perfil—, el sistema DEBE (MUST) usarlo, junto con la institución y el formato, como referencia de la transacción en la cuenta: una fila cuyo identificador ya tiene una transacción no anulada en la cuenta DEBE (MUST) clasificarse como ya importada aunque cambien su descripción o su fecha.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el perfil declara la columna "Nro. Doc." como no única y el extracto trae el interés de 12.40 BOB y su retención de 1.60 BOB con la misma referencia "88231"
Entonces las dos filas son nuevas y al aprobar se crean dos transacciones
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
