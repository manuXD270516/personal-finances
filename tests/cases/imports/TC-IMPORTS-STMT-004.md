---
id: TC-IMPORTS-STMT-004
title: "El texto del fixture imita el formato de la entidad: mismos importes, saldos y fechas que el expected"
spec: imports/import-pipeline
related_specs: []
requirement: "El fixture imita el formato de la entidad"
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
  - "Formatear cada valor del expected con el separador de miles y decimal y el formato de fecha de la entidad"
  - "Buscarlo como token aislado en statement.txt"
expected_result:
  - "Cada importe, saldo, fecha y hora del expected aparece en el texto con el formato de la entidad"
  - "No hay coincidencias dentro de otros números"
created: 2026-10-16
updated: 2026-10-16
---

# TC-IMPORTS-STMT-004 — El texto del fixture imita el formato de la entidad: mismos importes, saldos y fechas que el expected

## Intención

Une el texto y el expected: si uno cambia sin el otro, el test falla.

## Escenario

```gherkin
Dado el texto y el expected de un fixture
Cuando se formatea cada valor como lo hace la entidad
Entonces aparece en el texto
```

## Notas

- Datos ficticios: instituciones "Banco Cumbre Demo", "Banco Pampa Demo", "Banco Sierra Demo" y "Banco Altiplano Demo"; titulares, cuentas, comercios y montos inventados. Nunca datos reales del owner (D255).
- Oráculo de fixtures, no un parser de producto (Phase 6/11). Fichas en `docs/statement-formats/`. Change: `add-exchange-house-rate-providers` (tarea 8.3).
