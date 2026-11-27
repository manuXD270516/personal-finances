---
id: TC-PLATFORM-PWA-015
title: "Colores del manifiesto"
spec: platform/web-interface
related_specs: []
requirement: "Barra de la aplicación instalada acorde al tema"
scenario: "Colores del manifiesto"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/brand/pwa.test.tsx
  - tests/e2e/specs/pwa.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["pwa", "theme"]
error_code: null
preconditions:
  - "manifiesto publicado"
input: {}
steps:
  - "se leen los colores del manifiesto"
expected_result:
  - "el color del tema y el de fondo son los de la superficie del tema claro"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-015 — Colores del manifiesto

## Intención

Verifica el requirement «Barra de la aplicación instalada acorde al tema» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado manifiesto publicado
Cuando se leen los colores del manifiesto
Entonces el color del tema y el de fondo son los de la superficie del tema claro
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
