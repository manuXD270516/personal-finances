---
id: TC-CLASSIFICATION-ALIAS-001
title: Una descripción bancaria se reconoce por el alias de la counterparty
spec: classification/counterparties
related_specs: []
requirement: Reconocimiento de counterparties por alias
scenario: Descripción bancaria reconocida por alias
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/domain/domain.test.ts
  - apps/web/src/ui/classification/classification.test.tsx
  - tests/e2e/specs/classification.spec.ts
status: automated
regression_suite: true
phase: 1
tags: [counterparties, alias]
error_code: null
preconditions:
- Counterparty activa "PedidosYa" con alias "pedidos ya"
- Counterparty archivada "Entel" con alias "entel"
input:
- resolve: COMPRA PEDIDOS  YA*LPZ 4471 por 85.50 BOB
- resolve: TRANSF 99812
- resolve: PAGO ENTEL 120.00
steps:
- Resolver cada descripción
expected_result:
- La primera reconoce "PedidosYa" (matchedOn = ALIAS)
- La segunda no reconoce ninguna counterparty
- La tercera no reconoce "Entel" porque está archivada
created: 2026-10-02
updated: 2026-10-04
---

# TC-CLASSIFICATION-ALIAS-001 — Una descripción bancaria se reconoce por el alias de la counterparty

## Intención

Los alias permiten reconocer al tercero en descripciones (base para imports y reglas en Phase 6).

## Escenario

```gherkin
Dada "PedidosYa" con alias "pedidos ya"
Cuando se busca "COMPRA PEDIDOS  YA*LPZ 4471 por 85.50 BOB"
Entonces se reconoce "PedidosYa"
```

## Notas

- Normalización: minúsculas, sin acentos, espacios colapsados; desempate por alias más largo.
