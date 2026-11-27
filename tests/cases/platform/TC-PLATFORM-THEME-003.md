---
id: TC-PLATFORM-THEME-003
title: "La página pública de error de inicio de sesión respeta el oscuro del sistema"
spec: platform/web-interface
related_specs: []
requirement: "Tema según la preferencia del sistema"
scenario: "Página pública en oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "dark-mode", "public"]
error_code: null
preconditions:
  - "contexto de navegador sin cookies"
input: {}
steps:
  - "sin sesión, abre /auth/error?reason=state con colorScheme dark"
expected_result:
  - "el fondo calculado es el del tema oscuro"
  - "axe no informa violaciones serious ni critical"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-003 — La página pública de error de inicio de sesión respeta el oscuro del sistema

## Intención

Verifica el requirement «Tema según la preferencia del sistema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado contexto de navegador sin cookies
Cuando sin sesión, abre /auth/error?reason=state con colorScheme dark
Entonces el fondo calculado es el del tema oscuro
  Y axe no informa violaciones serious ni critical
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
