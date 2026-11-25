---
id: TC-PLATFORM-WEBUI-021
title: "El aviso de registro sigue visible a los 5 minutos y no mueve el foco"
spec: platform/web-interface
related_specs: ["transactions/transaction-recording"]
requirement: "Región de avisos de la sesión"
scenario: "Aviso persistente sin robar el foco"
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
tags: ["notices","a11y","focus","wcag-2.2.1"]
error_code: null
preconditions:
  - "page.clock instalado"
  - "un EDITOR en el alta"
input:
  monto: "45.00"
  moneda: "BOB"
steps:
  - "el usuario registra un gasto de 45.00 BOB"
  - "se adelanta el reloj 5 minutos"
  - "el usuario pulsa \"Cerrar\" en el aviso"
expected_result:
  - "la región con nombre \"Avisos\" contiene el aviso tras 5 minutos"
  - "el foco siguió en el monto mientras el aviso aparecía"
  - "tras \"Cerrar\" el aviso ya no está"
  - "axe no informa violaciones serious ni critical con el aviso visible"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-021 — El aviso de registro sigue visible a los 5 minutos y no mueve el foco

## Intención

Verifica M-07: avisos persistentes (la guía prefiere persistencia y un límite corto choca con WCAG 2.2.1) que no roban el foco.

## Escenario

```gherkin
Dado page.clock instalado
  Y un EDITOR en el alta
Cuando el usuario registra un gasto de 45.00 BOB
  Y se adelanta el reloj 5 minutos
  Y el usuario pulsa "Cerrar" en el aviso
Entonces la región con nombre "Avisos" contiene el aviso tras 5 minutos
  Y el foco siguió en el monto mientras el aviso aparecía
  Y tras "Cerrar" el aviso ya no está
  Y axe no informa violaciones serious ni critical con el aviso visible
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
