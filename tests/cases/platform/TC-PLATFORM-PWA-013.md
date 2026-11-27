---
id: TC-PLATFORM-PWA-013
title: "Abrir la aplicación instalada sin sesión"
spec: platform/web-interface
related_specs: []
requirement: "Sesión en la aplicación instalada"
scenario: "Abrir la aplicación instalada sin sesión"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-SEC-001"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: manual
automated_tests: []
status: ready
regression_suite: false
phase: 9
tags: ["pwa", "manual", "auth"]
error_code: null
preconditions:
  - "aplicación instalada en un Android (Chrome) y en un iPhone (Safari) desde el stack servido por HTTPS"
  - "sesión vencida"
input: {}
steps:
  - "el OWNER abre la aplicación instalada con la sesión vencida"
expected_result:
  - "ve el inicio de sesión y, al completarlo, vuelve a Inicio dentro de la aplicación"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-013 — Abrir la aplicación instalada sin sesión

## Intención

Verifica el requirement «Sesión en la aplicación instalada» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado aplicación instalada en un Android (Chrome) y en un iPhone (Safari) desde el stack servido por HTTPS
  Y sesión vencida
Cuando el OWNER abre la aplicación instalada con la sesión vencida
Entonces ve el inicio de sesión y, al completarlo, vuelve a Inicio dentro de la aplicación
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Requiere instalar de verdad: se verifica a mano en dispositivos (tarea 7.7). Al implementarse pasa a `automation_status: manual` y `status: ready`.
