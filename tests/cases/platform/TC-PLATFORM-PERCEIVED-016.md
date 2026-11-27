---
id: TC-PLATFORM-PERCEIVED-016
title: "Título largo en español"
spec: platform/web-interface
related_specs: []
requirement: "Títulos y párrafos legibles"
scenario: "Título largo en español"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-001", "NFR-USAB-005"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/perceived-css.test.ts
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["typography"]
error_code: null
preconditions:
  - "OWNER con sesión a 360 × 800"
input: {}
steps:
  - "el OWNER abre a 360 px una página cuyo título ocupa dos líneas en español"
expected_result:
  - "el título declara el reparto equilibrado de líneas"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-016 — Título largo en español

## Intención

Verifica el requirement «Títulos y párrafos legibles» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión a 360 × 800
Cuando el OWNER abre a 360 px una página cuyo título ocupa dos líneas en español
Entonces el título declara el reparto equilibrado de líneas
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
