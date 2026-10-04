---
id: TC-CLASSIFICATION-KIND-002
title: Se rechaza una categoría de gasto en un ingreso y se acepta en un reembolso
spec: classification/categories
related_specs: [transactions/transaction-recording]
requirement: Compatibilidad del tipo de categoría con el movimiento
scenario: Ingreso con categoría de gasto
requirement_status: confirmed
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [categories, kind, cross-context]
error_code: CATEGORY_KIND_MISMATCH
preconditions:
- Categoría de gasto "Supermercado" con gastos por 500.00 BOB en el mes
- Cuenta "Banco BOB" activa
input:
- income:
    amount: '3500.00'
    currency: BOB
    category: Supermercado
- refund:
    amount: '50.00'
    currency: BOB
    category: Supermercado
steps:
- Registrar el ingreso
- Registrar el reembolso
- Consultar el gasto del mes en "Supermercado"
expected_result:
- El ingreso se rechaza con CATEGORY_KIND_MISMATCH y no se crea transacción ni asiento
- El reembolso se acepta
- El gasto del mes en "Supermercado" pasa de 500.00 BOB a 450.00 BOB
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-KIND-002 — Se rechaza una categoría de gasto en un ingreso y se acepta en un reembolso

## Intención

Regla de compatibilidad tipo↔signo de la porción (docs/04 §3.5) aplicada vía ValidateClassification.

## Escenario

```gherkin
Dada la categoría de gasto "Supermercado"
Cuando se registra un ingreso de 3,500.00 BOB con ella
Entonces se rechaza con "CATEGORY_KIND_MISMATCH"
Cuando se registra un reembolso de 50.00 BOB con ella
Entonces se acepta y reduce el gasto del mes en 50.00 BOB
```

## Notas

- Requiere add-transaction-recording para el flujo completo; la validación unitaria vive en ValidateClassification.
- Revisado 2026-10-04: se mantiene `not_automated` (advertencia R3 intencional). El test con su id valida `ValidateClassification`; falta el flujo de API (ingreso rechazado sin transacción ni asiento y el gasto del mes 500.00 → 450.00 BOB tras el reembolso).
