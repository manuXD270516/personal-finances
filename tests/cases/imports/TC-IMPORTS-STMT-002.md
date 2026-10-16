---
id: TC-IMPORTS-STMT-002
title: "El saldo inicial más créditos menos débitos da el saldo final y el saldo corrido cuadra fila a fila"
spec: imports/import-pipeline
related_specs: []
requirement: "Coherencia de saldos de los extractos de ejemplo"
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
  - "Fixtures de extractos sintéticos con movimientos en el orden impreso"
input: {"fixtures": "tests/fixtures/imports/statements-bo"}
steps:
  - "Sumar los importes con signo con Decimal"
  - "Recorrer el saldo corrido en el orden impreso"
expected_result:
  - "saldo inicial + suma de importes = saldo final"
  - "cada saldo impreso = saldo previo + importe, incluidas las filas no cronológicas"
  - "los importes tienen 2 decimales exactos (HALF_EVEN no los altera)"
created: 2026-10-16
updated: 2026-10-16
---

# TC-IMPORTS-STMT-002 — El saldo inicial más créditos menos débitos da el saldo final y el saldo corrido cuadra fila a fila

## Intención

Sin esta coherencia el oráculo no sirve para validar un futuro parser contra el saldo declarado del extracto.

## Escenario

```gherkin
Dado el expected de cada fixture
Cuando se recorre el saldo corrido
Entonces cada saldo coincide
    Y el saldo final cuadra con el declarado
```

## Notas

- Datos ficticios: instituciones "Banco Cumbre Demo", "Banco Pampa Demo", "Banco Sierra Demo" y "Banco Altiplano Demo"; titulares, cuentas, comercios y montos inventados. Nunca datos reales del owner (D255).
- Oráculo de fixtures, no un parser de producto (Phase 6/11). Fichas en `docs/statement-formats/`. Change: `add-exchange-house-rate-providers` (tarea 8.3).
