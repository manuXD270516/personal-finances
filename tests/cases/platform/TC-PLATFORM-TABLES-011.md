---
id: TC-PLATFORM-TABLES-011
title: "Los montos se ordenan por su valor y no por el texto formateado"
spec: platform/web-interface
related_specs: ["reporting/financial-reports"]
requirement: "Orden por columna en tablas comparativas"
scenario: "Ordenar montos por su valor"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/sort.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "sort", "money"]
error_code: null
preconditions:
  - "Alimentación 1234.56 BOB, Transporte 999.00 BOB y Salud 45.30 BOB en el periodo"
input:
  montos: ["1234.56", "999.00", "45.30"]
  moneda: "BOB"
steps:
  - "el OWNER ordena el reporte de gastos por categoría por Monto de mayor a menor"
expected_result:
  - "el orden de filas es Alimentación, Transporte, Salud"
  - "la función de orden compara Decimal y no strings (test unitario con 1234.56, 999.00 y 45.30)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-011 — Los montos se ordenan por su valor y no por el texto formateado

## Intención

Verifica el requirement «Orden por columna en tablas comparativas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado Alimentación 1234.56 BOB, Transporte 999.00 BOB y Salud 45.30 BOB en el periodo
Cuando el OWNER ordena el reporte de gastos por categoría por Monto de mayor a menor
Entonces el orden de filas es Alimentación, Transporte, Salud
  Y la función de orden compara Decimal y no strings (test unitario con 1234.56, 999.00 y 45.30)
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
