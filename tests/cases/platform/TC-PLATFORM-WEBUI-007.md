---
id: TC-PLATFORM-WEBUI-007
title: "Un monto obligatorio vacío y sin tocar no muestra error al salir"
spec: platform/web-interface
related_specs: []
requirement: "Validación de montos al salir del campo"
scenario: "Campo obligatorio sin tocar"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/forms.test.ts
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","forms"]
error_code: null
preconditions:
  - "el formulario de gasto recién abierto con el monto vacío"
input:
  monto: ""
steps:
  - "el usuario entra al monto y sale con Tab sin escribir"
expected_result:
  - "el campo no muestra ningún mensaje ni aria-invalid"
  - "al enviar el formulario aparece el error de obligatorio"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-007 — Un monto obligatorio vacío y sin tocar no muestra error al salir

## Intención

Evita el error prematuro de obligatorio que la guía de validación tras la interacción desaconseja.

## Escenario

```gherkin
Dado el formulario de gasto recién abierto con el monto vacío
Cuando el usuario entra al monto y sale con Tab sin escribir
Entonces el campo no muestra ningún mensaje ni aria-invalid
  Y al enviar el formulario aparece el error de obligatorio
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
