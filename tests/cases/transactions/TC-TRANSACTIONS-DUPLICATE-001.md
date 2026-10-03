---
id: TC-TRANSACTIONS-DUPLICATE-001
title: "Una transacción manual parecida a otra se advierte como posible duplicado sin bloquear ni eliminar"
spec: transactions/duplicate-detection
related_specs: []
requirement: "Advertencia de posibles duplicados en la entrada manual"
scenario: "Mismo gasto registrado al día siguiente"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-031]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/duplicate-detector.test.ts
  - packages/contexts/transactions/test/integration/pg-transactions.int.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["duplicates"]
error_code: null
preconditions:
  - "Gasto posteado G1 en Bank A: 45.90 BOB, contraparte \"Supermercado Demo\", fecha 2026-03-10"
  - "Ventana de duplicados: misma cuenta, mismo monto y moneda, ±3 días, descripción o contraparte similar"
input:
  - account: "Bank A"
    amount: "45.90 BOB"
    counterparty: "Supermercado Demo"
    date: "2026-03-11"
  - account: "Bank A"
    amount: "45.90 BOB"
    counterparty: "Supermercado Demo"
    date: "2026-03-14"
  - account: "Credit Card"
    amount: "45.90 BOB"
    counterparty: "Supermercado Demo"
    date: "2026-03-11"
steps:
  - "Consultar posibles duplicados para el primer input antes de guardar"
  - "Registrar cada gasto"
  - "Listar las transacciones de Bank A"
expected_result:
  - "Consulta previa: devuelve G1 como candidato y no persiste nada"
  - "Primer gasto: 201 con warnings[0].code = POSSIBLE_DUPLICATE que referencia G1"
  - "Segundo (4 días) y tercero (otra cuenta): 201 sin advertencias"
  - "Todas las transacciones permanecen; nada se elimina ni se fusiona"
created: 2026-10-01
updated: 2026-10-02
---

# TC-TRANSACTIONS-DUPLICATE-001 — Una transacción manual parecida a otra se advierte como posible duplicado sin bloquear ni eliminar

## Intención

La detección de duplicados asiste al usuario; nunca debe alterar silenciosamente los datos financieros.

## Escenario

```gherkin
Dado un gasto de 45.90 BOB en "Supermercado Demo" el 2026-03-10
Cuando se registra otro gasto de 45.90 BOB en "Supermercado Demo" el 2026-03-11
Entonces el nuevo gasto se registra con una advertencia de posible duplicado
  Y ambos gastos permanecen registrados
```

## Notas

- Phase 1 solo advierte; la marca persistente y su resolución (keep/skip/merge) pertenecen a Phase 6 (FR-TRANSACTIONS-032).
