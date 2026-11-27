---
id: TC-PLATFORM-PWA-008
title: "Aplicación ya instalada"
spec: platform/web-interface
related_specs: []
requirement: "Botón «Instalar» solo cuando el navegador lo ofrece"
scenario: "Aplicación ya instalada"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-001", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa"]
error_code: null
preconditions:
  - "EDITOR con sesión, con la presentación independiente simulada"
input: {}
steps:
  - "el EDITOR abre Mis preferencias desde la aplicación instalada"
expected_result:
  - "no aparece el botón «Instalar la aplicación»"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-008 — Aplicación ya instalada

## Intención

Verifica el requirement «Botón «Instalar» solo cuando el navegador lo ofrece» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión, con la presentación independiente simulada
Cuando el EDITOR abre Mis preferencias desde la aplicación instalada
Entonces no aparece el botón «Instalar la aplicación»
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
