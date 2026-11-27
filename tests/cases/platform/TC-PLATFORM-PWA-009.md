---
id: TC-PLATFORM-PWA-009
title: "Instalación aceptada"
spec: platform/web-interface
related_specs: []
requirement: "Botón «Instalar» solo cuando el navegador lo ofrece"
scenario: "Instalación aceptada"
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
  - "EDITOR con sesión y el botón «Instalar la aplicación» visible"
input: {}
steps:
  - "el EDITOR acepta el diálogo de instalación del navegador"
expected_result:
  - "el botón «Instalar la aplicación» desaparece sin recargar la página"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-009 — Instalación aceptada

## Intención

Verifica el requirement «Botón «Instalar» solo cuando el navegador lo ofrece» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión y el botón «Instalar la aplicación» visible
Cuando el EDITOR acepta el diálogo de instalación del navegador
Entonces el botón «Instalar la aplicación» desaparece sin recargar la página
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
