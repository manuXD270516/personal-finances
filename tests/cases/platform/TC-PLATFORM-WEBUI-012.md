---
id: TC-PLATFORM-WEBUI-012
title: "Con movimiento reducido los esqueletos de carga del Home no se desplazan"
spec: platform/web-interface
related_specs: ["reporting/dashboard"]
requirement: "Movimiento reducido declarado por componente"
scenario: "Preferencia de menos movimiento"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","motion"]
error_code: null
preconditions:
  - "Playwright con reducedMotion: 'reduce'"
  - "las respuestas del Home demoradas para que se vean los esqueletos"
input: {}
steps:
  - "el usuario abre el Home"
expected_result:
  - "el animation-name calculado de los esqueletos es none o una animación solo de opacidad"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-012 — Con movimiento reducido los esqueletos de carga del Home no se desplazan

## Intención

Comprueba que la variante de movimiento reducido se declara junto a la animación, sin la regla global prohibida por la guía (M-26).

## Escenario

```gherkin
Dado Playwright con reducedMotion: 'reduce'
  Y las respuestas del Home demoradas para que se vean los esqueletos
Cuando el usuario abre el Home
Entonces el animation-name calculado de los esqueletos es none o una animación solo de opacidad
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
