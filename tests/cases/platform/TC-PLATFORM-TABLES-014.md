---
id: TC-PLATFORM-TABLES-014
title: "La utilización de una tarjeta se expone como medida"
spec: platform/web-interface
related_specs: ["debt/credit-cards"]
requirement: "Medidas y procesos con su rol propio"
scenario: "Utilización de una tarjeta"
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
  - "tarjeta con límite 1000.00 BOB y 850.00 BOB usados"
input:
  limite: "1000.00"
  usado: "850.00"
  moneda: "BOB"
steps:
  - "el OWNER abre el detalle de la tarjeta"
expected_result:
  - "hay un elemento con rol meter de valor 85 y texto \"85 %\" visible"
  - "no hay role=\"progressbar\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-014 — La utilización de una tarjeta se expone como medida

## Intención

Verifica el requirement «Medidas y procesos con su rol propio» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado tarjeta con límite 1000.00 BOB y 850.00 BOB usados
Cuando el OWNER abre el detalle de la tarjeta
Entonces hay un elemento con rol meter de valor 85 y texto "85 %" visible
  Y no hay role="progressbar"
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
