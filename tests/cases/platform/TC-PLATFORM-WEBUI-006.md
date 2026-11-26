---
id: TC-PLATFORM-WEBUI-006
title: "El error de escala desaparece en cuanto el monto vuelve a ser válido"
spec: platform/web-interface
related_specs: []
requirement: "Validación de montos al salir del campo"
scenario: "Corrección mientras escribe"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-003","NFR-USAB-101"]
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
tags: ["a11y","forms","money"]
error_code: null
preconditions:
  - "el monto \"10.1234567\" en una cuenta USDT con el error de escala visible"
input:
  montoCorregido: "10.123456"
  moneda: "USDT"
steps:
  - "el usuario borra el último dígito sin salir del campo"
expected_result:
  - "el mensaje desaparece"
  - "el campo deja de tener aria-invalid=\"true\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-006 — El error de escala desaparece en cuanto el monto vuelve a ser válido

## Intención

Comprueba la matriz de tiempos: mientras se corrige, el error se limpia en cuanto el valor es válido, y el estado visual coincide con el de las tecnologías de asistencia.

## Escenario

```gherkin
Dado el monto "10.1234567" en una cuenta USDT con el error de escala visible
Cuando el usuario borra el último dígito sin salir del campo
Entonces el mensaje desaparece
  Y el campo deja de tener aria-invalid="true"
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
