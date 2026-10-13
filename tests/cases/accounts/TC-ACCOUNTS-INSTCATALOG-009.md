---
id: TC-ACCOUNTS-INSTCATALOG-009
title: "La validación del catálogo detecta censo incompleto, códigos repetidos y falta de fecha de corte"
spec: accounts/institutions
related_specs: []
requirement: "Completitud del catálogo frente al censo oficial"
scenario: "Falta una entidad del censo"
requirement_status: provisional
fr: ["FR-ACCOUNTS-012"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog"]
error_code: null
preconditions:
  - "Versiones ficticias del catálogo"
input: {"census": {"MULTIPLE_BANK": 2}, "entries": ["BAD"]}
steps:
  - "Validar una versión con censo de 2 bancos múltiples y 1 entrada"
  - "Validar una con BAD repetido"
  - "Validar una sin fecha de corte"
expected_result:
  - "Falla indicando MULTIPLE_BANK y la diferencia de 1"
  - "Falla por código repetido"
  - "Falla por falta de fecha de corte"
created: 2026-10-13
updated: 2026-10-13
---

# TC-ACCOUNTS-INSTCATALOG-009 — La validación del catálogo detecta censo incompleto, códigos repetidos y falta de fecha de corte

## Intención

El catálogo no puede declararse completo si no cubre el censo oficial.

## Escenario

```gherkin
Dado un censo de 2 bancos múltiples
Cuando el catálogo tiene 1
Entonces la validación falla
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
