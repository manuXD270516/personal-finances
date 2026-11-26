---
id: TC-PLATFORM-MOBNAV-003
title: "Desde 768 px no hay barra inferior"
spec: platform/web-interface
related_specs: []
requirement: "Barra de navegación inferior en pantallas angostas"
scenario: "Escritorio sin barra inferior"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "navigation", "desktop"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER abre Inicio a 1280 × 800 y a 768 × 1024"
expected_result:
  - "la barra inferior no está visible en ninguno de los dos anchos"
  - "la barra lateral está visible; captura de escritorio adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-003 — Desde 768 px no hay barra inferior

## Intención

Verifica el requirement «Barra de navegación inferior en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER abre Inicio a 1280 × 800 y a 768 × 1024
Entonces la barra inferior no está visible en ninguno de los dos anchos
  Y la barra lateral está visible; captura de escritorio adjuntada
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
