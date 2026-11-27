---
id: TC-PLATFORM-PERCEIVED-020
title: "Motivo de anulación largo"
spec: platform/web-interface
related_specs: []
requirement: "Campos de texto largos que crecen con su contenido"
scenario: "Motivo de anulación largo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-005"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["forms", "field-sizing"]
error_code: null
preconditions:
  - "EDITOR con sesión y un gasto de 80.00 BOB"
input: {}
steps:
  - "el EDITOR escribe un motivo de anulación de seis líneas para un gasto de 80.00 BOB en un navegador con soporte"
expected_result:
  - "el campo crece hasta mostrar las seis líneas sin desplazamiento interno, sin superar su alto máximo"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-020 — Motivo de anulación largo

## Intención

Verifica el requirement «Campos de texto largos que crecen con su contenido» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión y un gasto de 80.00 BOB
Cuando el EDITOR escribe un motivo de anulación de seis líneas para un gasto de 80.00 BOB en un navegador con soporte
Entonces el campo crece hasta mostrar las seis líneas sin desplazamiento interno, sin superar su alto máximo
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
