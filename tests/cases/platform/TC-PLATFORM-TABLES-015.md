---
id: TC-PLATFORM-TABLES-015
title: "El avance de una meta se expone como medida"
spec: platform/web-interface
related_specs: ["goals/savings-goals"]
requirement: "Medidas y procesos con su rol propio"
scenario: "Avance de una meta"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-104"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["meter", "a11y"]
error_code: null
preconditions:
  - "meta de 15000.00 BOB con 5000.00 BOB ahorrados"
input:
  objetivo: "15000.00"
  ahorrado: "5000.00"
  moneda: "BOB"
steps:
  - "el OWNER abre el detalle de la meta"
expected_result:
  - "hay un elemento con rol meter con valor 33.33 de 100 y su texto visible \"33,33 %\""
  - "no hay role=\"progressbar\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-015 — El avance de una meta se expone como medida

## Intención

Verifica el requirement «Medidas y procesos con su rol propio» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado meta de 15000.00 BOB con 5000.00 BOB ahorrados
Cuando el OWNER abre el detalle de la meta
Entonces hay un elemento con rol meter con valor 33.33 de 100 y su texto visible "33,33 %"
  Y no hay role="progressbar"
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
