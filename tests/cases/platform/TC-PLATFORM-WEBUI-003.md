---
id: TC-PLATFORM-WEBUI-003
title: "El alta de préstamo con tres errores muestra el resumen y lo enfoca"
spec: platform/web-interface
related_specs: []
requirement: "Resumen de errores en formularios largos"
scenario: "Alta de préstamo con tres errores"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101","NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/forms.test.ts
  - apps/web/src/ui/common/ui.test.tsx
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","forms","error-summary"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "el formulario de alta de préstamo abierto"
input:
  monto: ""
  tasa: ""
  fechaInicio: ""
steps:
  - "el usuario envía el alta sin monto, sin tasa y sin fecha de inicio"
expected_result:
  - "al inicio del formulario aparece el resumen \"Hay 3 errores\" con un enlace por campo"
  - "el foco queda en el resumen"
  - "el texto del resumen sale del catálogo en es, en y pt"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-003 — El alta de préstamo con tres errores muestra el resumen y lo enfoca

## Intención

Verifica el resumen de errores de los formularios largos (préstamo, tarjeta, mapeo del import), donde el primer error puede quedar fuera de la pantalla.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y el formulario de alta de préstamo abierto
Cuando el usuario envía el alta sin monto, sin tasa y sin fecha de inicio
Entonces al inicio del formulario aparece el resumen "Hay 3 errores" con un enlace por campo
  Y el foco queda en el resumen
  Y el texto del resumen sale del catálogo en es, en y pt
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
