---
id: TC-IMPORTS-STMT-003
title: "Los totales declarados (secciones de BNB, ITF y resumen de BISA) coinciden con los movimientos"
spec: imports/import-pipeline
related_specs: []
requirement: "Coherencia de totales de los extractos de ejemplo"
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
  - "Fixtures bnb (dos secciones), ganadero y bisa (sin actividad)"
input: {"fixtures": "tests/fixtures/imports/statements-bo"}
steps:
  - "Sumar créditos y débitos por sección"
  - "Comparar con los totales y el resumen declarados"
expected_result:
  - "Total depósitos y total retiros coinciden con las secciones"
  - "Los débitos y créditos del resumen coinciden"
  - "El extracto sin actividad mantiene el saldo y tiene un resumen en cero"
created: 2026-10-16
updated: 2026-10-16
---

# TC-IMPORTS-STMT-003 — Los totales declarados (secciones de BNB, ITF y resumen de BISA) coinciden con los movimientos

## Intención

Los formatos con secciones separadas solo se validan contra sus totales, no contra un saldo corrido.

## Escenario

```gherkin
Dado un extracto con secciones Depósitos y Retiros
Cuando se suman los movimientos
Entonces coinciden con los totales declarados
```

## Notas

- Datos ficticios: instituciones "Banco Cumbre Demo", "Banco Pampa Demo", "Banco Sierra Demo" y "Banco Altiplano Demo"; titulares, cuentas, comercios y montos inventados. Nunca datos reales del owner (D255).
- Oráculo de fixtures, no un parser de producto (Phase 6/11). Fichas en `docs/statement-formats/`. Change: `add-exchange-house-rate-providers` (tarea 8.3).
