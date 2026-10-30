---
id: TC-IMPORTS-PDF-046
title: "Un extracto PDF de 100 páginas y 5 000 movimientos llega a revisión en 30 segundos o menos"
spec: imports/import-pipeline
related_specs: []
requirement: "Rendimiento de la lectura de un extracto PDF"
scenario: "Extracto PDF de 5 000 movimientos"
requirement_status: provisional
fr: ["FR-PERF-007", "FR-IMPORTS-016"]
nfr: ["NFR-PERF-007"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/imports.perf.ts
  - packages/contexts/imports/src/infrastructure/pdf/pdf-large.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Extracto PDF de 5 000 movimientos\" del delta de add-pdf-statement-parser"
steps:
  - "un EDITOR importa un extracto PDF sintético de 100 páginas con 5 000 movimientos nuevos"
expected_result:
  - "la importación queda \"en revisión\" en 30 segundos o menos desde su creación"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-046 — Un extracto PDF de 100 páginas y 5 000 movimientos llega a revisión en 30 segundos o menos

## Intención

Una importación desde un extracto PDF de 100 páginas con 5 000 movimientos DEBERÍA (SHOULD) llegar a la vista previa en 30 segundos o menos en el entorno de referencia, incluida la extracción en el hilo aislado, y el benchmark de imports DEBE (MUST) medirlo y reportarlo.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un EDITOR importa un extracto PDF sintético de 100 páginas con 5 000 movimientos nuevos
Entonces la importación queda "en revisión" en 30 segundos o menos desde su creación
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Fila del benchmark de imports (imports.perf.ts); el PDF se genera en el arranque del benchmark y no se versiona.
