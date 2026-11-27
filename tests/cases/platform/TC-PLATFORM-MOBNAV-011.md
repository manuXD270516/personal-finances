---
id: TC-PLATFORM-MOBNAV-011
title: "El marco se ajusta al cambiar el alto visible"
spec: platform/web-interface
related_specs: []
requirement: "Alto de pantalla dinámico y áreas seguras"
scenario: "Cambio del alto visible"
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
tags: ["mobile", "dvh"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "a 360 × 640 en Inicio, page.setViewportSize({ width: 360, height: 720 })"
expected_result:
  - "el alto del marco es igual a window.innerHeight antes y después"
  - "la barra inferior queda pegada al borde inferior"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-011 — El marco se ajusta al cambiar el alto visible

## Intención

Verifica el requirement «Alto de pantalla dinámico y áreas seguras» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando a 360 × 640 en Inicio, page.setViewportSize({ width: 360, height: 720 })
Entonces el alto del marco es igual a window.innerHeight antes y después
  Y la barra inferior queda pegada al borde inferior
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
