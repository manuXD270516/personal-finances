---
id: TC-PLATFORM-MOBNAV-010
title: "El foco nunca queda tapado por la barra inferior"
spec: platform/web-interface
related_specs: []
requirement: "Alto de pantalla dinámico y áreas seguras"
scenario: "Foco no tapado por la barra inferior"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "focus", "wcag-2.4.11"]
error_code: null
preconditions:
  - "al menos 20 transacciones en la lista"
input: {}
steps:
  - "a 360 × 640 en Transacciones, el OWNER pulsa Tab hasta los enlaces del pie de la pantalla"
expected_result:
  - "para cada elemento enfocado, su borde inferior queda por encima del borde superior de la barra inferior"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-010 — El foco nunca queda tapado por la barra inferior

## Intención

Verifica el requirement «Alto de pantalla dinámico y áreas seguras» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado al menos 20 transacciones en la lista
Cuando a 360 × 640 en Transacciones, el OWNER pulsa Tab hasta los enlaces del pie de la pantalla
Entonces para cada elemento enfocado, su borde inferior queda por encima del borde superior de la barra inferior
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
