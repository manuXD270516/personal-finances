---
id: TC-PLATFORM-API-019
title: Las fechas de negocio son YYYY-MM-DD en la zona del workspace y los instantes UTC con Z
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Fechas de negocio frente a instantes
scenario: Gasto registrado cerca de medianoche en La Paz
requirement_status: confirmed
fr: []
nfr:
- NFR-USAB-004
- NFR-DATA-011
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- dates
- timezone
error_code: null
preconditions:
- W1 con zona America/La_Paz; reloj fijo en 2026-10-01T03:30:00Z (2026-09-30 23:30 en La Paz)
- EDITOR autenticado
input:
- transactionDate: '2026-09-30'
  amount:
    amount: '75.00'
    currency: BOB
- transactionDate: '2026-09-30T23:30:00-04:00'
  amount:
    amount: '75.00'
    currency: BOB
steps:
- Registrar el gasto con cada fecha
- Leer el gasto creado
expected_result:
- 'Primero: transactionDate "2026-09-30" y createdAt "2026-10-01T03:30:00.000Z"'
- 'Segundo: 400 VALIDATION_FAILED'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-019 — Las fechas de negocio son YYYY-MM-DD en la zona del workspace y los instantes UTC con Z

## Intención

Confundir fecha de negocio con instante produce errores off-by-one en límites de mes (NFR-USAB-004).

## Escenario

```gherkin
Dado que en La Paz son las 23:30 del 2026-09-30
Cuando se registra un gasto de 75.00 BOB con fecha de negocio "2026-09-30"
Entonces la fecha de negocio devuelta es "2026-09-30"
  Y el instante de creación es "2026-10-01T03:30:00.000Z"
```

## Notas

- Requiere add-transaction-recording; antes se verifica con createdAt de POST /workspaces y un controller de prueba con LocalDate.
