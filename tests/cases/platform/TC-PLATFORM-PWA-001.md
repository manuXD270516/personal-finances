---
id: TC-PLATFORM-PWA-001
title: "Manifiesto sin sesión"
spec: platform/web-interface
related_specs: []
requirement: "Manifiesto de la aplicación instalable"
scenario: "Manifiesto sin sesión"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-006", "NFR-SEC-008"]
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
tags: ["pwa"]
error_code: null
preconditions:
  - "persona sin sesión"
input: {}
steps:
  - "una persona sin sesión pide el manifiesto de la aplicación"
expected_result:
  - "recibe el manifiesto con estado 200, tipo de contenido JSON y sin redirección al inicio de sesión"
  - "el manifiesto declara la identidad «/», el inicio «/», el alcance «/», la presentación independiente y el idioma «es-BO»"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-001 — Manifiesto sin sesión

## Intención

Verifica el requirement «Manifiesto de la aplicación instalable» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado persona sin sesión
Cuando una persona sin sesión pide el manifiesto de la aplicación
Entonces recibe el manifiesto con estado 200, tipo de contenido JSON y sin redirección al inicio de sesión
  Y el manifiesto declara la identidad «/», el inicio «/», el alcance «/», la presentación independiente y el idioma «es-BO»
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
