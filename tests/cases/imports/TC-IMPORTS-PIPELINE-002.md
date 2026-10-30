---
id: TC-IMPORTS-PIPELINE-002
title: "Una vinculación preseleccionada de confianza alta cuenta como decisión al aprobar"
spec: imports/import-pipeline
related_specs: ["transactions/duplicate-detection"]
requirement: "Deduplicación básica con movimientos existentes"
scenario: "Vinculación preseleccionada cuenta como decisión"
requirement_status: provisional
fr: ["FR-IMPORTS-007", "FR-TRANSACTIONS-031", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pipeline-logic.test.ts
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/application/duplicate-matching.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
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
input: "Datos del scenario \"Vinculación preseleccionada cuenta como decisión\" del delta de add-import-pipeline"
steps:
  - "la única fila con candidato tiene un solo candidato de puntaje 0.9000 y el usuario aprueba sin tocarla"
expected_result:
  - "la aprobación no se rechaza por decisiones pendientes"
  - "la fila queda vinculada al movimiento existente sin crear una transacción"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-002 — Una vinculación preseleccionada de confianza alta cuenta como decisión al aprobar

## Intención

Cada fila nueva DEBE (MUST) compararse con los movimientos no anulados de la cuenta —gastos, ingresos y patas de transferencias y conversiones— del mismo monto y moneda, en la misma dirección y con fecha a ±3 días; si hay candidatos, la fila DEBE (MUST) clasificarse como posible duplicado mostrando los candidatos ordenados por su puntaje y exigir una decisión: crearla, omitirla vinculándola a un movimiento existente o excluirla.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la única fila con candidato tiene un solo candidato de puntaje 0.9000 y el usuario aprueba sin tocarla
Entonces la aprobación no se rechaza por decisiones pendientes
  Y la fila queda vinculada al movimiento existente sin crear una transacción
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
