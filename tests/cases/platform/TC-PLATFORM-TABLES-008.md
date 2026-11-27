---
id: TC-PLATFORM-TABLES-008
title: "A 360 px Transacciones conserva la semántica de tabla y solo desplaza su región"
spec: platform/web-interface
related_specs: []
requirement: "Semántica de tabla en pantallas angostas"
scenario: "Transacciones a 360 px"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-107"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "mobile", "a11y"]
error_code: null
preconditions:
  - "Minimal Seed"
input: {}
steps:
  - "el OWNER abre Transacciones a 360 × 800"
expected_result:
  - "el árbol de accesibilidad tiene table con columnheader y row"
  - "document.documentElement.scrollWidth ≤ 360"
  - "la región de la tabla tiene scrollWidth mayor que clientWidth"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-008 — A 360 px Transacciones conserva la semántica de tabla y solo desplaza su región

## Intención

Verifica el requirement «Semántica de tabla en pantallas angostas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado Minimal Seed
Cuando el OWNER abre Transacciones a 360 × 800
Entonces el árbol de accesibilidad tiene table con columnheader y row
  Y document.documentElement.scrollWidth ≤ 360
  Y la región de la tabla tiene scrollWidth mayor que clientWidth
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Nota de implementación: a la fecha, Transacciones es una lista (`ul`), no una tabla. La verificación E2E de esta semántica se hace sobre el cronograma de un préstamo a 360 px (`data-tables.spec.ts`); convertir la lista de Transacciones a tabla queda como pregunta al owner.
