---
id: TC-PLATFORM-THEME-016
title: "El Home en oscuro no tiene tarjetas con colores fijos claros"
spec: platform/web-interface
related_specs: []
requirement: "Colores de la interfaz solo desde el tema"
scenario: "Home en oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "dashboard"]
error_code: null
preconditions:
  - "un gasto de 245.30 BOB en el mes"
input:
  monto: "245.30"
  moneda: "BOB"
steps:
  - "el OWNER abre Inicio con el tema «Oscuro»"
expected_result:
  - "ninguna tarjeta del Home tiene fondo calculado rgb(255, 255, 255)"
  - "los montos y las barras usan los colores del tema oscuro"
  - "captura a 360 px y a 1280 px adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-016 — El Home en oscuro no tiene tarjetas con colores fijos claros

## Intención

Verifica el requirement «Colores de la interfaz solo desde el tema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado un gasto de 245.30 BOB en el mes
Cuando el OWNER abre Inicio con el tema «Oscuro»
Entonces ninguna tarjeta del Home tiene fondo calculado rgb(255, 255, 255)
  Y los montos y las barras usan los colores del tema oscuro
  Y captura a 360 px y a 1280 px adjuntada
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
