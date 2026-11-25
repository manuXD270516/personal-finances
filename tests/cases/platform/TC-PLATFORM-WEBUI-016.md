---
id: TC-PLATFORM-WEBUI-016
title: "A 360 px las pestañas del préstamo ocupan una fila sin cambiar de ancho"
spec: platform/web-interface
related_specs: ["debt/loans"]
requirement: "Pestañas en una sola fila"
scenario: "Detalle de préstamo en el teléfono"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006","NFR-USAB-102"]
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
tags: ["a11y","tabs","mobile"]
error_code: null
preconditions:
  - "viewport de 360 x 800"
  - "un préstamo activo"
input: {}
steps:
  - "el usuario abre el detalle del préstamo"
  - "selecciona otra pestaña"
expected_result:
  - "todas las pestañas tienen el mismo offsetTop"
  - "la lista de pestañas tiene desplazamiento horizontal"
  - "el ancho de cada pestaña no cambia al seleccionarla"
  - "la seleccionada tiene un borde inferior visible"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-016 — A 360 px las pestañas del préstamo ocupan una fila sin cambiar de ancho

## Intención

Verifica M-15: en el teléfono las pestañas saltaban de fila y cambiaban de ancho al cambiar el peso de la fuente.

## Escenario

```gherkin
Dado viewport de 360 x 800
  Y un préstamo activo
Cuando el usuario abre el detalle del préstamo
  Y selecciona otra pestaña
Entonces todas las pestañas tienen el mismo offsetTop
  Y la lista de pestañas tiene desplazamiento horizontal
  Y el ancho de cada pestaña no cambia al seleccionarla
  Y la seleccionada tiene un borde inferior visible
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
