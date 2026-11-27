---
id: TC-PLATFORM-TABLES-007
title: "El cronograma impreso contiene las 36 cuotas con la cabecera repetida"
spec: platform/web-interface
related_specs: []
requirement: "Tablas completas al imprimir"
scenario: "Imprimir el cronograma de un préstamo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
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
tags: ["tables", "print"]
error_code: null
preconditions:
  - "un préstamo de 12000.00 BOB a 36 cuotas"
input:
  principal: "12000.00"
  moneda: "BOB"
  cuotas: 36
steps:
  - "el OWNER abre el cronograma"
  - "page.emulateMedia({ media: \"print\" }) y page.pdf()"
expected_result:
  - "la región no tiene alto máximo ni overflow en impresión"
  - "el texto del PDF contiene las cuotas 1 a 36"
  - "el thead se repite (display table-header-group)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-007 — El cronograma impreso contiene las 36 cuotas con la cabecera repetida

## Intención

Verifica el requirement «Tablas completas al imprimir» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un préstamo de 12000.00 BOB a 36 cuotas
Cuando el OWNER abre el cronograma
  Y page.emulateMedia({ media: "print" }) y page.pdf()
Entonces la región no tiene alto máximo ni overflow en impresión
  Y el texto del PDF contiene las cuotas 1 a 36
  Y el thead se repite (display table-header-group)
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
