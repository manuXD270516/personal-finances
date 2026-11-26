---
id: TC-PLATFORM-TABLES-005
title: "Una tabla corta no tiene desplazamiento vertical propio"
spec: platform/web-interface
related_specs: []
requirement: "Cabecera fija en tablas de mucho volumen"
scenario: "Tabla corta sin desplazamiento propio"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["tables"]
error_code: null
preconditions:
  - "un presupuesto con 6 líneas"
input: {}
steps:
  - "el OWNER abre el presupuesto del periodo"
expected_result:
  - "la región de la tabla tiene scrollHeight igual a clientHeight"
  - "la región no tiene alto máximo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-005 — Una tabla corta no tiene desplazamiento vertical propio

## Intención

Verifica el requirement «Cabecera fija en tablas de mucho volumen» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un presupuesto con 6 líneas
Cuando el OWNER abre el presupuesto del periodo
Entonces la región de la tabla tiene scrollHeight igual a clientHeight
  Y la región no tiene alto máximo
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
