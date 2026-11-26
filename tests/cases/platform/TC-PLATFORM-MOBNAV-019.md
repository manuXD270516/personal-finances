---
id: TC-PLATFORM-MOBNAV-019
title: "Sin preferencia de movimiento el cajón entra con una transición corta"
spec: platform/web-interface
related_specs: []
requirement: "Entrada y salida suaves de la capa superior"
scenario: "Cajón sin preferencia de movimiento"
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
  - "con reducedMotion \"no-preference\" el OWNER abre «Más» a 360 px"
expected_result:
  - "transition-property calculada del cajón incluye opacity y transform"
  - "transition-duration ≤ 200 ms"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-019 — Sin preferencia de movimiento el cajón entra con una transición corta

## Intención

Verifica el requirement «Entrada y salida suaves de la capa superior» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando con reducedMotion "no-preference" el OWNER abre «Más» a 360 px
Entonces transition-property calculada del cajón incluye opacity y transform
  Y transition-duration ≤ 200 ms
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
