---
id: TC-PLATFORM-THEME-004
title: "Elegir «Oscuro» en Preferencias aplica el tema sin recargar y queda auditado"
spec: platform/web-interface
related_specs: []
requirement: "Preferencia de tema en Preferencias"
scenario: "Elegir el tema oscuro"
requirement_status: confirmed
fr: ["FR-IDENTITY-003"]
nfr: ["NFR-USAB-103"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "preferences", "audit"]
error_code: null
preconditions:
  - "EDITOR sin preferencia de tema"
input: {}
steps:
  - "el EDITOR abre Preferencias con colorScheme light"
  - "elige «Oscuro» y guarda"
expected_result:
  - "la página pasa a oscuro sin navegación"
  - "GET /me devuelve preferences.theme = \"dark\" y una versión mayor"
  - "el historial de auditoría tiene un cambio de preferencias del usuario"
  - "la cookie pfos_theme vale dark"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-004 — Elegir «Oscuro» en Preferencias aplica el tema sin recargar y queda auditado

## Intención

Verifica el requirement «Preferencia de tema en Preferencias» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado EDITOR sin preferencia de tema
Cuando el EDITOR abre Preferencias con colorScheme light
  Y elige «Oscuro» y guarda
Entonces la página pasa a oscuro sin navegación
  Y GET /me devuelve preferences.theme = "dark" y una versión mayor
  Y el historial de auditoría tiene un cambio de preferencias del usuario
  Y la cookie pfos_theme vale dark
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
