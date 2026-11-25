---
id: TC-PLATFORM-WEBUI-010
title: "Revertir un import se confirma en un diálogo modal de alerta"
spec: platform/web-interface
related_specs: ["imports/import-pipeline"]
requirement: "Confirmación de acciones irreversibles en un diálogo modal"
scenario: "Revertir un import"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101","NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","dialog","imports"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "un import aplicado con transacciones creadas"
input: {}
steps:
  - "el usuario pulsa \"Revertir\" en el import"
  - "el usuario confirma en el diálogo"
expected_result:
  - "la confirmación es un diálogo modal con role=\"alertdialog\" y el foco en \"Cancelar\""
  - "al confirmar, la reversión se ejecuta con las mismas reglas y mensajes de siempre"
  - "el data-testid revert-confirm está en el diálogo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-010 — Revertir un import se confirma en un diálogo modal de alerta

## Intención

Comprueba la migración de otro uso irreversible y que el testid se conserva para los specs existentes.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y un import aplicado con transacciones creadas
Cuando el usuario pulsa "Revertir" en el import
  Y el usuario confirma en el diálogo
Entonces la confirmación es un diálogo modal con role="alertdialog" y el foco en "Cancelar"
  Y al confirmar, la reversión se ejecuta con las mismas reglas y mensajes de siempre
  Y el data-testid revert-confirm está en el diálogo
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
