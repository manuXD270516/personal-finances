---
id: TC-IMPORTS-CSV-020
title: "Una fila igual a un gasto manual o a una transferencia registrada es posible duplicado"
spec: imports/import-pipeline
related_specs: ["transactions/duplicate-detection","transactions/transfers"]
requirement: "Deduplicación básica con movimientos existentes"
scenario: "Gasto registrado a mano"
requirement_status: confirmed
fr: ["FR-IMPORTS-007","FR-TRANSACTIONS-031","FR-TRANSACTIONS-032"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/duplicate-classifier.test.ts
  - packages/contexts/transactions/test/integration/pg-imported.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "Gasto manual posteado 245.30 BOB \"Supermercado\" del 2026-10-02 en \"Banco BOB\""
  - "Transferencia manual de 400.00 BOB de \"Banco BOB\" a \"Visa\" del 2026-10-10"
input: {"rows":[["01/10/2026","COMPRA SUPERMERCADO","-245,30"],["10/10/2026","PAGO TARJETA","-400,00"]]}
steps:
  - "Aplicar el mapeo a las dos filas"
  - "Repetir con el gasto manual fechado 2026-10-06"
expected_result:
  - "Fila del supermercado: DUPLICATE_PROBABLE con el gasto manual como candidato"
  - "Fila PAGO TARJETA: DUPLICATE_PROBABLE con la transferencia como candidato"
  - "Con el gasto del 2026-10-06 (5 días): la fila es NEW"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-020 — Una fila igual a un gasto manual o a una transferencia registrada es posible duplicado

## Intención

Lo cargado a mano antes del extracto no debe duplicarse, incluidas las transferencias propias (pregunta abierta 4).

## Escenario

```gherkin
Dado un gasto manual de 245.30 BOB del 2026-10-02 y una transferencia de 400.00 BOB del 2026-10-10
Cuando mapeo las filas del 01/10 y del 10/10
Entonces ambas son posibles duplicados con su candidato
```

## Notas

- Cubre también los scenarios "Pago de tarjeta registrado como transferencia" y "Fuera de la ventana de días".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
