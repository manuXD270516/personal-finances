---
id: TC-PLATFORM-PWA-012
title: "Sin conexión"
spec: platform/web-interface
related_specs: []
requirement: "Instalación sin funcionamiento sin conexión"
scenario: "Sin conexión"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008", "NFR-SEC-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/pwa.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["pwa", "offline"]
error_code: null
preconditions:
  - "OWNER con sesión y un gasto de 45.00 BOB registrado"
input: {}
steps:
  - "el OWNER, tras ver un gasto de 45.00 BOB en Transacciones, pierde la conexión y recarga la página"
expected_result:
  - "no se muestra el gasto de 45.00 BOB ni ningún otro dato guardado"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-012 — Sin conexión

## Intención

Verifica el requirement «Instalación sin funcionamiento sin conexión» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y un gasto de 45.00 BOB registrado
Cuando el OWNER, tras ver un gasto de 45.00 BOB en Transacciones, pierde la conexión y recarga la página
Entonces no se muestra el gasto de 45.00 BOB ni ningún otro dato guardado
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
