---
id: TC-PLATFORM-WEBUI-008
title: "Anular un gasto abre un diálogo modal de alerta con el foco en Cancelar"
spec: platform/web-interface
related_specs: ["transactions/transaction-recording"]
requirement: "Confirmación de acciones irreversibles en un diálogo modal"
scenario: "Anular un gasto"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009"]
nfr: ["NFR-USAB-101","NFR-USAB-102","NFR-USAB-108"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/ui.test.tsx
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","dialog","axe"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "un gasto posteado de 60.00 BOB en \"Banco BOB\" con saldo 940.00 BOB"
input:
  monto: "60.00"
  moneda: "BOB"
steps:
  - "el usuario abre el detalle del gasto y pulsa \"Anular\""
expected_result:
  - "se abre un diálogo con role=\"alertdialog\" cuyo nombre accesible es el título de la anulación"
  - "el foco queda en \"Cancelar\", que precede a la acción de anular en el orden de tabulación"
  - "pulsar Tab varias veces nunca enfoca un elemento fuera del diálogo"
  - "axe no informa violaciones serious ni critical con el diálogo abierto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-008 — Anular un gasto abre un diálogo modal de alerta con el foco en Cancelar

## Intención

Verifica M-06 nivel (b): las confirmaciones con efecto contable pasan a un <dialog> modal, con el foco en la acción segura y el fondo inerte.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y un gasto posteado de 60.00 BOB en "Banco BOB" con saldo 940.00 BOB
Cuando el usuario abre el detalle del gasto y pulsa "Anular"
Entonces se abre un diálogo con role="alertdialog" cuyo nombre accesible es el título de la anulación
  Y el foco queda en "Cancelar", que precede a la acción de anular en el orden de tabulación
  Y pulsar Tab varias veces nunca enfoca un elemento fuera del diálogo
  Y axe no informa violaciones serious ni critical con el diálogo abierto
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
