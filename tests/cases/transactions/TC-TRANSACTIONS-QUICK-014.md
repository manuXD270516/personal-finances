---
id: TC-TRANSACTIONS-QUICK-014
title: "El EDITOR ve Registrar en la barra superior y abre el alta con foco en el monto"
spec: transactions/transaction-recording
related_specs: []
requirement: "Acceso directo para registrar"
scenario: "Acceso del EDITOR"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-001"]
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/shell/nav.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","navigation"]
error_code: null
preconditions:
  - "un EDITOR con sesión en \"Presupuestos\""
input: {}
steps:
  - "el usuario activa \"Registrar\" de la barra superior"
expected_result:
  - "el enlace tiene nombre accesible \"Registrar\" y objetivo táctil de al menos 44 px"
  - "se abre /transacciones/nueva con el foco en el monto"
  - "en /transacciones/nueva la barra superior no muestra el acceso"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-014 — El EDITOR ve Registrar en la barra superior y abre el alta con foco en el monto

## Intención

Deja el alta a un toque desde cualquier pantalla; la barra inferior móvil llega con el lote L4.

## Escenario

```gherkin
Dado un EDITOR con sesión en "Presupuestos"
Cuando el usuario activa "Registrar" de la barra superior
Entonces el enlace tiene nombre accesible "Registrar" y objetivo táctil de al menos 44 px
  Y se abre /transacciones/nueva con el foco en el monto
  Y en /transacciones/nueva la barra superior no muestra el acceso
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
