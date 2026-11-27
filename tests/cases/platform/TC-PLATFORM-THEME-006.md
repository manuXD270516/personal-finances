---
id: TC-PLATFORM-THEME-006
title: "La barra superior no ofrece ningún control de tema"
spec: platform/web-interface
related_specs: []
requirement: "Preferencia de tema en Preferencias"
scenario: "Sin control de tema en la barra superior"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "shell"]
error_code: null
preconditions:
  - "EDITOR con sesión"
input: {}
steps:
  - "el EDITOR recorre Inicio, Transacciones y Presupuestos"
expected_result:
  - "la barra superior no contiene ningún control con nombre de tema (es, en y pt)"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-006 — La barra superior no ofrece ningún control de tema

## Intención

Verifica el requirement «Preferencia de tema en Preferencias» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión
Cuando el EDITOR recorre Inicio, Transacciones y Presupuestos
Entonces la barra superior no contiene ningún control con nombre de tema (es, en y pt)
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
