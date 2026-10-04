---
id: TC-CLASSIFICATION-TAG-002
title: Un gasto con dos tags cuenta completo en cada tag sin duplicar el gasto total
spec: classification/tags
related_specs: [transactions/transaction-recording, reporting/dashboard]
requirement: Múltiples tags por porción de transacción
scenario: Gasto con dos tags
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-ledger.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: [tags, reporting]
error_code: null
preconditions:
- Tags activos "Viaje Santa Cruz 2026" y "Trabajo" sin movimientos
- Gasto total del mes = 1,000.00 BOB
input:
  record:
    amount: '230.00'
    currency: BOB
    category: Restaurantes
    tags:
    - Viaje Santa Cruz 2026
    - Trabajo
    - Trabajo
steps:
- Registrar el gasto
- Consultar totales por tag y gasto total del mes
expected_result:
- La porción queda con dos tags distintos (sin repetir "Trabajo")
- Total del tag "Viaje Santa Cruz 2026" = 230.00 BOB; total del tag "Trabajo" = 230.00 BOB
- Gasto total del mes = 1,230.00 BOB (aumenta exactamente 230.00 BOB)
created: 2026-10-02
updated: 2026-10-04
---

# TC-CLASSIFICATION-TAG-002 — Un gasto con dos tags cuenta completo en cada tag sin duplicar el gasto total

## Intención

Los tags son transversales: el monto se atribuye completo a cada tag, sin doble conteo en totales.

## Escenario

```gherkin
Dado un gasto total del mes de 1,000.00 BOB
Cuando se registra un gasto de 230.00 BOB con los tags "Viaje Santa Cruz 2026" y "Trabajo"
Entonces cada tag suma 230.00 BOB
  Y el gasto total del mes es 1,230.00 BOB
```

## Notas

- Se automatiza cuando exista add-transaction-recording (tasks 7.3).
- Automatizado 2026-10-04 (add-classification 7.3). El tag repetido ("Trabajo" dos veces) lo rechaza el contrato (`SplitInput.tagIds` con `uniqueItems`) con 400 `VALIDATION_FAILED` en lugar de deduplicarlo; en ningún caso queda un tag repetido en la porción. Totales por tag sobre las porciones vigentes (no hay reporte por tag en Phase 1) y filtro `tagId` del listado.
