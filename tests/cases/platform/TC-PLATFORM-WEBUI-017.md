---
id: TC-PLATFORM-WEBUI-017
title: "Con Fin la última pestaña queda seleccionada y visible a 360 px"
spec: platform/web-interface
related_specs: ["debt/loans"]
requirement: "Pestañas en una sola fila"
scenario: "Pestaña fuera de la vista con el teclado"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","tabs","keyboard"]
error_code: null
preconditions:
  - "viewport de 360 x 800"
  - "el foco en la primera pestaña del detalle de un préstamo"
input:
  tecla: "End"
steps:
  - "el usuario pulsa Fin"
expected_result:
  - "la última pestaña tiene aria-selected=\"true\" y el foco"
  - "la pestaña está dentro del área visible de la lista (toBeInViewport)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-017 — Con Fin la última pestaña queda seleccionada y visible a 360 px

## Intención

Comprueba que el desplazamiento horizontal no esconde la pestaña enfocada al navegar con el teclado.

## Escenario

```gherkin
Dado viewport de 360 x 800
  Y el foco en la primera pestaña del detalle de un préstamo
Cuando el usuario pulsa Fin
Entonces la última pestaña tiene aria-selected="true" y el foco
  Y la pestaña está dentro del área visible de la lista (toBeInViewport)
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
