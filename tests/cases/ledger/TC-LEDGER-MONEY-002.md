---
id: TC-LEDGER-MONEY-002
title: "Los montos decimales hacen round-trip exacto entre Decimal, NUMERIC(38,18) y strings de la API"
spec: ledger/journal-posting
related_specs: ["platform/api-conventions"]
requirement: "Aritmética monetaria decimal exacta"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-006]
nfr: []
invariants: [INV-001, INV-002]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["money", "numeric", "precision"]
error_code: null
preconditions: ["PostgreSQL vía Testcontainers con una columna de monto NUMERIC(38,18)"]
input:
  sums:
    - a: "0.1"
      b: "0.2"
      expected: "0.3"
  round_trip:
    - "12345678901234567890.123456789012345678"
    - "-0.000000000000000001"
    - "685.00"
    - "0.00000001"
  api:
    amount: "685"
    currency: "BOB"
    serialized: "{\"amount\":\"685.00\",\"currency\":\"BOB\"}"
steps:
  - "Sumar Money(\"0.1\") + Money(\"0.2\")"
  - "Persistir cada valor de round_trip a través del adaptador Kysely y volver a leerlo"
  - "Serializar Money(685, BOB) a través del mapper de la API"
expected_result:
  - "0.1 + 0.2 = 0.3 exactamente"
  - "Cada valor leído es idéntico (comparación de strings) al valor escrito"
  - "La API serializa los montos como strings decimales completados a la escala de la moneda: \"685.00\""
  - "La moneda siempre está presente junto al monto (INV-002)"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-MONEY-002 — Los montos decimales hacen round-trip exacto entre Decimal, NUMERIC(38,18) y strings de la API

## Intención

Protege contra la pérdida de precisión en el driver pg (NUMERIC parseado como number de JS) y en la serialización JSON.

## Escenario

```gherkin
Dado un monto "12345678901234567890.123456789012345678"
Cuando se almacena y se vuelve a leer desde PostgreSQL
Entonces el valor leído es idéntico al valor almacenado
```
