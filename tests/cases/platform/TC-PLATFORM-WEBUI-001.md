---
id: TC-PLATFORM-WEBUI-001
title: "Un gasto enviado sin monto ni cuenta deja el foco en el primer campo inválido"
spec: platform/web-interface
related_specs: []
requirement: "Foco al primer campo inválido tras un envío fallido"
scenario: "Gasto sin monto ni cuenta"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101","NFR-USAB-102","NFR-USAB-009"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","forms","focus"]
error_code: null
preconditions:
  - "un EDITOR con sesión en el workspace de prueba (es-BO)"
  - "el formulario de alta de gasto abierto en /transacciones/nueva"
input:
  monto: ""
  cuenta: ""
steps:
  - "el usuario pulsa \"Registrar\" sin completar monto ni cuenta"
expected_result:
  - "el foco queda en el primero de los dos campos según el orden visual del formulario"
  - "ambos campos tienen aria-invalid=\"true\" y su mensaje enlazado por aria-describedby"
  - "el mensaje de error no está dentro de una región viva"
  - "no se envía ninguna solicitud POST de transacción"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-001 — Un gasto enviado sin monto ni cuenta deja el foco en el primer campo inválido

## Intención

Verifica el scenario "Gasto sin monto ni cuenta": sin foco al error, quien usa lector de pantalla o el teclado del teléfono pulsa "Registrar" y no sabe qué falla (M-01).

## Escenario

```gherkin
Dado un EDITOR con sesión en el workspace de prueba (es-BO)
  Y el formulario de alta de gasto abierto en /transacciones/nueva
Cuando el usuario pulsa "Registrar" sin completar monto ni cuenta
Entonces el foco queda en el primero de los dos campos según el orden visual del formulario
  Y ambos campos tienen aria-invalid="true" y su mensaje enlazado por aria-describedby
  Y el mensaje de error no está dentro de una región viva
  Y no se envía ninguna solicitud POST de transacción
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
