---
id: TC-IMPORTS-STMT-005
title: "Los fixtures cubren los casos difíciles de los extractos reales"
spec: imports/import-pipeline
related_specs: []
requirement: "Los fixtures cubren los casos difíciles"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-005"]
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/statement-fixtures.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["imports","statement-fixtures","synthetic"]
error_code: null
preconditions:
  - "Fixtures de extractos sintéticos"
input: {"fixtures": "tests/fixtures/imports/statements-bo"}
steps:
  - "Inspeccionar los expected y el texto"
expected_result:
  - "Hay descripciones multilínea y montos con miles"
  - "Hay un movimiento cortado en el salto de página y filas no cronológicas"
  - "BNB tiene las secciones Depósitos y Retiros y una página en blanco"
  - "BISA es USD con coma decimal y sin actividad"
created: 2026-10-16
updated: 2026-10-16
---

# TC-IMPORTS-STMT-005 — Los fixtures cubren los casos difíciles de los extractos reales

## Intención

Fija los riesgos de parseo de las fichas como casos que un parser de Phase 6 deberá pasar.

## Escenario

```gherkin
Dado los cuatro fixtures
Cuando se inspeccionan
Entonces cubren multilínea, corte de página, orden no cronológico, secciones y cuenta USD sin actividad
```

## Notas

- Datos ficticios: instituciones "Banco Cumbre Demo", "Banco Pampa Demo", "Banco Sierra Demo" y "Banco Altiplano Demo"; titulares, cuentas, comercios y montos inventados. Nunca datos reales del owner (D255).
- Oráculo de fixtures, no un parser de producto (Phase 6/11). Fichas en `docs/statement-formats/`. Change: `add-exchange-house-rate-providers` (tarea 8.3).
