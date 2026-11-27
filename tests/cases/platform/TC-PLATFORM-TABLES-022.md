---
id: TC-PLATFORM-TABLES-022
title: "Ninguna regla difiere el dibujo de filas de tabla"
spec: platform/web-interface
related_specs: []
requirement: "Filas de tabla dibujadas completas"
scenario: "Sin contención en filas de tabla"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/tables.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "performance", "static"]
error_code: null
preconditions:
  - "apps/web en el estado del change"
input: {}
steps:
  - "el test recorre app/globals.css, src/**/*.css y src/**/*.tsx de apps/web"
expected_result:
  - "no hay content-visibility ni contain en selectores de tr, tbody o thead, ni en estilos en línea de esos elementos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-022 — Ninguna regla difiere el dibujo de filas de tabla

## Intención

Verifica el requirement «Filas de tabla dibujadas completas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado apps/web en el estado del change
Cuando el test recorre app/globals.css, src/**/*.css y src/**/*.tsx de apps/web
Entonces no hay content-visibility ni contain en selectores de tr, tbody o thead, ni en estilos en línea de esos elementos
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
