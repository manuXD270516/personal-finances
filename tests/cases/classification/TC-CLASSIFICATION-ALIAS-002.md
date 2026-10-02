---
id: TC-CLASSIFICATION-ALIAS-002
title: Un alias no puede pertenecer a dos counterparties del workspace
spec: classification/counterparties
related_specs: []
requirement: Alias únicos por workspace
scenario: Alias en uso
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [counterparties, alias]
error_code: COUNTERPARTY_ALIAS_TAKEN
preconditions:
- '"PedidosYa" con alias "pedidos ya"'
- Counterparty "Yaigo" sin alias
input:
  update:
    counterparty: Yaigo
    aliases:
    - Pedidos Ya
steps:
- Añadir el alias a "Yaigo"
expected_result:
- La operación se rechaza con COUNTERPARTY_ALIAS_TAKEN
- '"Yaigo" queda sin alias'
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-ALIAS-002 — Un alias no puede pertenecer a dos counterparties del workspace

## Intención

Alias ambiguos harían no determinista el reconocimiento.

## Escenario

```gherkin
Dada "PedidosYa" con alias "pedidos ya"
Cuando el usuario añade "Pedidos Ya" a "Yaigo"
Entonces se rechaza con "COUNTERPARTY_ALIAS_TAKEN"
```

## Notas

- Alias de menos de 3 caracteres normalizados → VALIDATION_FAILED (caso borde).
