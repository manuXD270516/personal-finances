---
id: TC-PLATFORM-THEME-007
title: "El VIEWER guarda su tema en el perfil"
spec: platform/web-interface
related_specs: []
requirement: "Preferencia de tema en Preferencias"
scenario: "El VIEWER también elige su tema"
requirement_status: confirmed
fr: ["FR-IDENTITY-003"]
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
  - apps/web/src/ui/identity/identity.test.tsx
status: automated
regression_suite: false
phase: 9
tags: ["theme", "preferences", "roles"]
error_code: null
preconditions:
  - "VIEWER del workspace"
  - "colorScheme dark"
input: {}
steps:
  - "el VIEWER elige «Claro» en Preferencias y guarda"
expected_result:
  - "preferences.theme = \"light\" en su /me"
  - "la página se muestra en claro"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-007 — El VIEWER guarda su tema en el perfil

## Intención

Verifica el requirement «Preferencia de tema en Preferencias» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado VIEWER del workspace
  Y colorScheme dark
Cuando el VIEWER elige «Claro» en Preferencias y guarda
Entonces preferences.theme = "light" en su /me
  Y la página se muestra en claro
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
