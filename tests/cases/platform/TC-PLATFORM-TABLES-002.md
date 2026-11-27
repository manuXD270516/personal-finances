---
id: TC-PLATFORM-TABLES-002
title: "Todas las tablas usan la región común con nombre"
spec: platform/web-interface
related_specs: []
requirement: "Tablas desplazables con nombre y alcanzables por teclado"
scenario: "Todas las tablas pasan por la región común"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/tables.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "static"]
error_code: null
preconditions:
  - "apps/web en el estado del change"
input: {}
steps:
  - "el test recorre src/**/*.tsx de apps/web"
expected_result:
  - "ningún archivo usa tableWrapStyle ni un envoltorio de tabla propio"
  - "cada <table> de datos está dentro de TableRegion con label"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-002 — Todas las tablas usan la región común con nombre

## Intención

Verifica el requirement «Tablas desplazables con nombre y alcanzables por teclado» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado apps/web en el estado del change
Cuando el test recorre src/**/*.tsx de apps/web
Entonces ningún archivo usa tableWrapStyle ni un envoltorio de tabla propio
  Y cada <table> de datos está dentro de TableRegion con label
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
