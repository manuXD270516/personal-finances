---
id: TC-PLATFORM-WEBUI-002
title: "Una transferencia con origen y destino iguales deja el foco en el destino"
spec: platform/web-interface
related_specs: []
requirement: "Foco al primer campo inválido tras un envío fallido"
scenario: "Transferencia con la misma cuenta de origen y destino"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101","NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","forms","focus"]
error_code: null
preconditions:
  - "un EDITOR con sesión y la cuenta \"Banco BOB\" activa"
  - "el formulario de transferencia abierto"
input:
  monto: "100.00"
  moneda: "BOB"
  origen: "Banco BOB"
  destino: "Banco BOB"
steps:
  - "el usuario envía la transferencia"
expected_result:
  - "el foco queda en el campo de destino"
  - "el campo muestra el mensaje de cuentas iguales del catálogo"
  - "no se envía ninguna solicitud de registro"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-002 — Una transferencia con origen y destino iguales deja el foco en el destino

## Intención

Comprueba que el mismo patrón de foco al error se aplica en otro formulario además del de gasto (utilidad común, M-01).

## Escenario

```gherkin
Dado un EDITOR con sesión y la cuenta "Banco BOB" activa
  Y el formulario de transferencia abierto
Cuando el usuario envía la transferencia
Entonces el foco queda en el campo de destino
  Y el campo muestra el mensaje de cuentas iguales del catálogo
  Y no se envía ninguna solicitud de registro
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
