---
id: TC-PLATFORM-MOBNAV-020
title: "Con movimiento reducido el cajón aparece sin desplazarse"
spec: platform/web-interface
related_specs: []
requirement: "Entrada y salida suaves de la capa superior"
scenario: "Cajón con movimiento reducido"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["motion", "top-layer"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "con reducedMotion \"reduce\" el OWNER abre y cierra «Más»"
expected_result:
  - "transition-property calculada del cajón no incluye transform"
  - "el cajón abre y cierra"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-020 — Con movimiento reducido el cajón aparece sin desplazarse

## Intención

Verifica el requirement «Entrada y salida suaves de la capa superior» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando con reducedMotion "reduce" el OWNER abre y cierra «Más»
Entonces transition-property calculada del cajón no incluye transform
  Y el cajón abre y cierra
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
