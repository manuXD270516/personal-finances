---
id: TC-PLATFORM-PERCEIVED-002
title: "Movimiento reducido"
spec: platform/web-interface
related_specs: []
requirement: "Transición al cambiar de pestaña o de filtro"
scenario: "Movimiento reducido"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-005", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["motion", "reduced-motion"]
error_code: null
preconditions:
  - "OWNER con sesión y transacciones de gasto e ingreso"
  - "movimiento reducido en el sistema"
input: {}
steps:
  - "el OWNER, con movimiento reducido en el sistema, aplica el filtro «Gastos» en Transacciones"
expected_result:
  - "la lista cambia sin ninguna transición"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-002 — Movimiento reducido

## Intención

Verifica el requirement «Transición al cambiar de pestaña o de filtro» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y transacciones de gasto e ingreso
  Y movimiento reducido en el sistema
Cuando el OWNER, con movimiento reducido en el sistema, aplica el filtro «Gastos» en Transacciones
Entonces la lista cambia sin ninguna transición
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
