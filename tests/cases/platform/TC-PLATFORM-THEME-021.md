---
id: TC-PLATFORM-THEME-021
title: "La impresión sale en claro aunque el tema sea oscuro"
spec: platform/web-interface
related_specs: []
requirement: "Impresión en esquema claro"
scenario: "Imprimir un reporte con el tema oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "print"]
error_code: null
preconditions:
  - "cookie pfos_theme=dark"
input: {}
steps:
  - "el OWNER abre el reporte de gastos por categoría con el tema «Oscuro»"
  - "page.emulateMedia({ media: \"print\" })"
expected_result:
  - "el fondo calculado de body es claro y el texto oscuro"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-021 — La impresión sale en claro aunque el tema sea oscuro

## Intención

Verifica el requirement «Impresión en esquema claro» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado cookie pfos_theme=dark
Cuando el OWNER abre el reporte de gastos por categoría con el tema «Oscuro»
  Y page.emulateMedia({ media: "print" })
Entonces el fondo calculado de body es claro y el texto oscuro
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
