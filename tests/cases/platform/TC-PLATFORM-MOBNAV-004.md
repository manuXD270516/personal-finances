---
id: TC-PLATFORM-MOBNAV-004
title: "«＋ Registrar» de la barra inferior abre el alta con el foco en el monto"
spec: platform/web-interface
related_specs: ["transactions/transaction-recording"]
requirement: "Barra de navegación inferior en pantallas angostas"
scenario: "Registrar desde la barra inferior"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-007"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "navigation", "quick-capture"]
error_code: null
preconditions:
  - "EDITOR con sesión"
  - "change add-quick-capture implementado"
input: {}
steps:
  - "a 360 px en Inicio, el EDITOR activa «＋ Registrar»"
expected_result:
  - "la URL es /transacciones/nueva"
  - "el foco está en el monto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-004 — «＋ Registrar» de la barra inferior abre el alta con el foco en el monto

## Intención

Verifica el requirement «Barra de navegación inferior en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión
  Y change add-quick-capture implementado
Cuando a 360 px en Inicio, el EDITOR activa «＋ Registrar»
Entonces la URL es /transacciones/nueva
  Y el foco está en el monto
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
