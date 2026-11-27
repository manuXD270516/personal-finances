---
id: TC-PLATFORM-TABLES-010
title: "La pista desaparece al llegar a la última columna"
spec: platform/web-interface
related_specs: []
requirement: "Pista de desplazamiento horizontal"
scenario: "Al final de la tabla"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "scroll-hint"]
error_code: null
preconditions:
  - "cronograma abierto a 360 px"
input: {}
steps:
  - "el OWNER desplaza la región hasta scrollLeft máximo"
expected_result:
  - "la máscara del borde derecho es transparente"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-010 — La pista desaparece al llegar a la última columna

## Intención

Verifica el requirement «Pista de desplazamiento horizontal» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado cronograma abierto a 360 px
Cuando el OWNER desplaza la región hasta scrollLeft máximo
Entonces la máscara del borde derecho es transparente
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
