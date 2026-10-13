---
id: TC-ACCOUNTS-INSTCATALOG-007
title: "La cobertura informa resueltas, pendientes y porcentajes HALF_EVEN y marca el soporte como no completo"
spec: accounts/institutions
related_specs: []
requirement: "Medición del soporte completo"
scenario: "Soporte incompleto"
requirement_status: provisional
fr: ["FR-ACCOUNTS-012", "FR-FX-009"]
nfr: []
invariants: []
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog", "coverage"]
error_code: null
preconditions:
  - "Censo BO de 3 entidades y catálogo con las 3"
input: {"rates": {"BAD": "IN_VERIFICATION", "CID": "NOT_ELIGIBLE", "BAL": "NOT_APPLICABLE"}}
steps:
  - "Calcular la cobertura"
  - "PBT: para listas arbitrarias de estados, resolved + pending = entradas activas y el porcentaje es HALF_EVEN a 2 decimales"
expected_result:
  - "Cobertura del censo 100.00 %"
  - "Tasas: 2 resueltas, 1 pendiente, 66.67 %; 1 NOT_ELIGIBLE informada aparte con su razón"
  - "complete = false"
created: 2026-10-13
updated: 2026-10-13
---

# TC-ACCOUNTS-INSTCATALOG-007 — La cobertura informa resueltas, pendientes y porcentajes HALF_EVEN y marca el soporte como no completo

## Intención

Hace medible 'soportar todas' (respuesta del owner a P14).

## Escenario

```gherkin
Dado BAD en verificación, CID no apta y BAL no aplica
Cuando se calcula la cobertura
Entonces hay 66.67 % resuelto
  Y el soporte no es completo
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
