---
id: TC-PLATFORM-WEBUI-024
title: "Con cuatro registros seguidos la región muestra solo los tres más recientes"
spec: platform/web-interface
related_specs: []
requirement: "Región de avisos de la sesión"
scenario: "Cuarto aviso"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/notices-state.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["notices"]
error_code: null
preconditions:
  - "un EDITOR en el alta con \"Banco BOB\""
input:
  montos: "10.00, 20.00, 30.00, 40.00 BOB"
steps:
  - "el usuario registra cuatro gastos seguidos sin cerrar los avisos"
expected_result:
  - "la región muestra exactamente tres avisos: Bs 20,00, Bs 30,00 y Bs 40,00"
  - "el gasto de Bs 10,00 sigue registrado y se puede anular desde su detalle"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-024 — Con cuatro registros seguidos la región muestra solo los tres más recientes

## Intención

Fija el límite de avisos visibles (decisión de diseño de docs/79) para que la región no tape el formulario.

## Escenario

```gherkin
Dado un EDITOR en el alta con "Banco BOB"
Cuando el usuario registra cuatro gastos seguidos sin cerrar los avisos
Entonces la región muestra exactamente tres avisos: Bs 20,00, Bs 30,00 y Bs 40,00
  Y el gasto de Bs 10,00 sigue registrado y se puede anular desde su detalle
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
