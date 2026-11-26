---
id: TC-PLATFORM-THEME-008
title: "Guardar otras preferencias no vuelve a escribir el tema"
spec: platform/web-interface
related_specs: []
requirement: "Preferencia de tema en Preferencias"
scenario: "Guardar sin cambiar el tema"
requirement_status: confirmed
fr: ["FR-IDENTITY-003"]
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "preferences"]
error_code: null
preconditions:
  - "perfil con tema «Claro»"
input: {}
steps:
  - "el usuario cambia solo la zona horaria a America/Sao_Paulo y guarda"
expected_result:
  - "hay un único PATCH /me y no incluye cambios de preferences.theme"
  - "preferences.theme sigue en \"light\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-008 — Guardar otras preferencias no vuelve a escribir el tema

## Intención

Verifica el requirement «Preferencia de tema en Preferencias» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil con tema «Claro»
Cuando el usuario cambia solo la zona horaria a America/Sao_Paulo y guarda
Entonces hay un único PATCH /me y no incluye cambios de preferences.theme
  Y preferences.theme sigue en "light"
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
