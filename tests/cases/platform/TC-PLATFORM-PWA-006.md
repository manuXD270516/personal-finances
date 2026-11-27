---
id: TC-PLATFORM-PWA-006
title: "El navegador ofrece la instalación"
spec: platform/web-interface
related_specs: []
requirement: "Botón «Instalar» solo cuando el navegador lo ofrece"
scenario: "El navegador ofrece la instalación"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-001", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/install.test.ts
  - tests/e2e/specs/pwa.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["pwa", "keyboard"]
error_code: null
preconditions:
  - "EDITOR con sesión en Chromium"
  - "aviso de instalación sintético despachado por la prueba"
input: {}
steps:
  - "el EDITOR abre Mis preferencias y el navegador avisa que la aplicación se puede instalar"
expected_result:
  - "aparece el botón «Instalar la aplicación», operable con el teclado"
  - "al usarlo se abre el diálogo de instalación del navegador"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-006 — El navegador ofrece la instalación

## Intención

Verifica el requirement «Botón «Instalar» solo cuando el navegador lo ofrece» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión en Chromium
  Y aviso de instalación sintético despachado por la prueba
Cuando el EDITOR abre Mis preferencias y el navegador avisa que la aplicación se puede instalar
Entonces aparece el botón «Instalar la aplicación», operable con el teclado
  Y al usarlo se abre el diálogo de instalación del navegador
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
