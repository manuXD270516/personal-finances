---
id: TC-PLATFORM-PWA-007
title: "Navegador sin aviso de instalación"
spec: platform/web-interface
related_specs: []
requirement: "Botón «Instalar» solo cuando el navegador lo ofrece"
scenario: "Navegador sin aviso de instalación"
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
  - "EDITOR con sesión, sin aviso de instalación"
input: {}
steps:
  - "el EDITOR abre Mis preferencias en un navegador que no avisa que la aplicación se puede instalar"
expected_result:
  - "no aparece ningún botón ni enlace de instalación"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-007 — Navegador sin aviso de instalación

## Intención

Verifica el requirement «Botón «Instalar» solo cuando el navegador lo ofrece» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión, sin aviso de instalación
Cuando el EDITOR abre Mis preferencias en un navegador que no avisa que la aplicación se puede instalar
Entonces no aparece ningún botón ni enlace de instalación
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
