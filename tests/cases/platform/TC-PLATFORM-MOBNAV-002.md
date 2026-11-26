---
id: TC-PLATFORM-MOBNAV-002
title: "A 360 px el VIEWER no ve «＋ Registrar»"
spec: platform/web-interface
related_specs: []
requirement: "Barra de navegación inferior en pantallas angostas"
scenario: "VIEWER en el teléfono"
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
tags: ["mobile", "navigation", "roles"]
error_code: null
preconditions:
  - "VIEWER del workspace"
input: {}
steps:
  - "un VIEWER abre Transacciones a 360 × 800"
expected_result:
  - "la barra inferior tiene Inicio, Transacciones, Plan y Más"
  - "no hay ningún destino «Registrar»"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-002 — A 360 px el VIEWER no ve «＋ Registrar»

## Intención

Verifica el requirement «Barra de navegación inferior en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado VIEWER del workspace
Cuando un VIEWER abre Transacciones a 360 × 800
Entonces la barra inferior tiene Inicio, Transacciones, Plan y Más
  Y no hay ningún destino «Registrar»
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
