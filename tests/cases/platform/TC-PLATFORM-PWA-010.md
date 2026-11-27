---
id: TC-PLATFORM-PWA-010
title: "Sin service worker"
spec: platform/web-interface
related_specs: []
requirement: "Instalación sin funcionamiento sin conexión"
scenario: "Sin service worker"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008", "NFR-SEC-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa", "security"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER recorre Inicio, Transacciones, el alta y Mis preferencias"
expected_result:
  - "el navegador no tiene ningún service worker registrado para el origen de la aplicación"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-010 — Sin service worker

## Intención

Verifica el requirement «Instalación sin funcionamiento sin conexión» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER recorre Inicio, Transacciones, el alta y Mis preferencias
Entonces el navegador no tiene ningún service worker registrado para el origen de la aplicación
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
