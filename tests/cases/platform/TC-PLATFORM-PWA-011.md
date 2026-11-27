---
id: TC-PLATFORM-PWA-011
title: "Política de seguridad sin cambios"
spec: platform/web-interface
related_specs: []
requirement: "Instalación sin funcionamiento sin conexión"
scenario: "Política de seguridad sin cambios"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008", "NFR-SEC-001"]
invariants: []
priority: high
type: security
level: security
automation_status: automated
automated_tests:
  - tests/e2e/specs/pwa.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["pwa", "csp"]
error_code: null
preconditions:
  - "política de seguridad de contenido de `origin/main` como base"
input: {}
steps:
  - "se comparan las directivas de la política de seguridad de contenido antes y después del change"
expected_result:
  - "son idénticas"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-011 — Política de seguridad sin cambios

## Intención

Verifica el requirement «Instalación sin funcionamiento sin conexión» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado política de seguridad de contenido de `origin/main` como base
Cuando se comparan las directivas de la política de seguridad de contenido antes y después del change
Entonces son idénticas
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
