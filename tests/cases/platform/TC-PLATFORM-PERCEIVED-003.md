---
id: TC-PLATFORM-PERCEIVED-003
title: "Navegador sin soporte de transiciones"
spec: platform/web-interface
related_specs: []
requirement: "Transición al cambiar de pestaña o de filtro"
scenario: "Navegador sin soporte de transiciones"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-005", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/motion.test.ts
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["motion", "progressive-enhancement"]
error_code: null
preconditions:
  - "OWNER con sesión y transacciones de gasto e ingreso"
  - "`document.startViewTransition` ausente (borrado por la prueba)"
input: {}
steps:
  - "el OWNER aplica el filtro «Gastos» en Transacciones en un navegador sin soporte de transiciones"
expected_result:
  - "la lista muestra solo los gastos, igual que con soporte"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-003 — Navegador sin soporte de transiciones

## Intención

Verifica el requirement «Transición al cambiar de pestaña o de filtro» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y transacciones de gasto e ingreso
  Y `document.startViewTransition` ausente (borrado por la prueba)
Cuando el OWNER aplica el filtro «Gastos» en Transacciones en un navegador sin soporte de transiciones
Entonces la lista muestra solo los gastos, igual que con soporte
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
