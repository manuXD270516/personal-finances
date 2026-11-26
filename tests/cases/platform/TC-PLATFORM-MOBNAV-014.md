---
id: TC-PLATFORM-MOBNAV-014
title: "En el alta de transacción no aparece la barra inferior"
spec: platform/web-interface
related_specs: ["transactions/transaction-recording"]
requirement: "Barra inferior oculta mientras se escribe"
scenario: "Página de alta"
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
tags: ["mobile", "quick-capture"]
error_code: null
preconditions:
  - "EDITOR con sesión"
input: {}
steps:
  - "a 360 px el EDITOR abre /transacciones/nueva"
  - "sale del monto con Tab hasta «Registrar»"
expected_result:
  - "la barra inferior no está visible en ningún paso"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-014 — En el alta de transacción no aparece la barra inferior

## Intención

Verifica el requirement «Barra inferior oculta mientras se escribe» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión
Cuando a 360 px el EDITOR abre /transacciones/nueva
  Y sale del monto con Tab hasta «Registrar»
Entonces la barra inferior no está visible en ningún paso
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
