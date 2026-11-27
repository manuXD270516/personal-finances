---
id: TC-PLATFORM-TABLES-003
title: "axe no informa regiones desplazables inalcanzables en las pantallas con tablas"
spec: platform/web-interface
related_specs: []
requirement: "Tablas desplazables con nombre y alcanzables por teclado"
scenario: "Análisis de accesibilidad de las tablas"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "a11y", "axe"]
error_code: null
preconditions:
  - "Minimal Seed, un préstamo y un import en vista previa"
input: {}
steps:
  - "a 360 px se analizan Transacciones, Presupuestos, un reporte, el cronograma de un préstamo y la vista previa de un import"
expected_result:
  - "axe no informa scrollable-region-focusable"
  - "axe no informa otras violaciones serious ni critical; capturas adjuntadas"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-003 — axe no informa regiones desplazables inalcanzables en las pantallas con tablas

## Intención

Verifica el requirement «Tablas desplazables con nombre y alcanzables por teclado» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado Minimal Seed, un préstamo y un import en vista previa
Cuando a 360 px se analizan Transacciones, Presupuestos, un reporte, el cronograma de un préstamo y la vista previa de un import
Entonces axe no informa scrollable-region-focusable
  Y axe no informa otras violaciones serious ni critical; capturas adjuntadas
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
