---
id: TC-IMPORTS-STMT-001
title: "Cada fixture sintético de extracto está marcado como tal y usa una institución ficticia"
spec: imports/import-pipeline
related_specs: []
requirement: "Los fixtures de extractos son siempre sintéticos"
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
  - "Fixtures tests/fixtures/imports/statements-bo/{bcp,ganadero,bisa,bnb}"
input: {"fixtures": "tests/fixtures/imports/statements-bo"}
steps:
  - "Leer statement.txt y expected.json de cada formato"
  - "Comprobar la marca SINTETICO y el nombre de institución"
expected_result:
  - "La primera línea de cada statement.txt empieza con la marca SINTETICO"
  - "expected.synthetic es true y la institución termina en Demo"
created: 2026-10-16
updated: 2026-10-16
---

# TC-IMPORTS-STMT-001 — Cada fixture sintético de extracto está marcado como tal y usa una institución ficticia

## Intención

Protege el repositorio público: ningún fixture de extracto puede pasar por real.

## Escenario

```gherkin
Dado los cuatro fixtures de extractos
Cuando se leen
Entonces están marcados como sintéticos
    Y usan una institución ficticia con sufijo Demo
```

## Notas

- Datos ficticios: instituciones "Banco Cumbre Demo", "Banco Pampa Demo", "Banco Sierra Demo" y "Banco Altiplano Demo"; titulares, cuentas, comercios y montos inventados. Nunca datos reales del owner (D255).
- Oráculo de fixtures, no un parser de producto (Phase 6/11). Fichas en `docs/statement-formats/`. Change: `add-exchange-house-rate-providers` (tarea 8.3).
