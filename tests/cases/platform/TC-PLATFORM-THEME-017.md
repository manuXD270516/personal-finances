---
id: TC-PLATFORM-THEME-017
title: "El recorrido en oscuro distingue sus estados con contraste y texto"
spec: platform/web-interface
related_specs: []
requirement: "Colores de la interfaz solo desde el tema"
scenario: "Recorrido en oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103", "NFR-USAB-104"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "lifecycle"]
error_code: null
preconditions:
  - "un gasto de 60.00 BOB anulado"
input:
  monto: "60.00"
  moneda: "BOB"
steps:
  - "el OWNER abre el recorrido de un gasto anulado con el tema «Oscuro»"
expected_result:
  - "los trazos de los estados recorrido, actual y no alcanzado tienen contraste ≥ 3:1 con el fondo"
  - "cada estado tiene su texto además del color"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-017 — El recorrido en oscuro distingue sus estados con contraste y texto

## Intención

Verifica el requirement «Colores de la interfaz solo desde el tema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado un gasto de 60.00 BOB anulado
Cuando el OWNER abre el recorrido de un gasto anulado con el tema «Oscuro»
Entonces los trazos de los estados recorrido, actual y no alcanzado tienen contraste ≥ 3:1 con el fondo
  Y cada estado tiene su texto además del color
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
