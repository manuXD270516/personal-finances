---
id: TC-PLATFORM-PWA-002
title: "Enlace al manifiesto desde las páginas"
spec: platform/web-interface
related_specs: []
requirement: "Manifiesto de la aplicación instalable"
scenario: "Enlace al manifiesto desde las páginas"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-USAB-006", "NFR-SEC-008"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa", "i18n", "csp"]
error_code: null
preconditions:
  - "usuario con sesión en un workspace con datos ficticios"
input: {}
steps:
  - "el OWNER abre Inicio, Transacciones y la página de error de inicio de sesión en es, en y pt"
expected_result:
  - "las tres páginas enlazan el mismo manifiesto"
  - "no se registra ninguna violación de la política de seguridad de contenido"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-002 — Enlace al manifiesto desde las páginas

## Intención

Verifica el requirement «Manifiesto de la aplicación instalable» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado usuario con sesión en un workspace con datos ficticios
Cuando el OWNER abre Inicio, Transacciones y la página de error de inicio de sesión en es, en y pt
Entonces las tres páginas enlazan el mismo manifiesto
  Y no se registra ninguna violación de la política de seguridad de contenido
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
