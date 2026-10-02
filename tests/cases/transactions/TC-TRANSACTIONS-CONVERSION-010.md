---
id: TC-TRANSACTIONS-CONVERSION-010
title: "Corregir una conversión genera reversa, asiento nuevo y detalle nuevo conservando el anterior"
spec: transactions/conversions
related_specs: ["ledger/journal-posting","audit/audit-trail"]
requirement: "Edición de una conversión por reversa y nuevo detalle"
scenario: "Corregir el monto recibido"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-024","FR-TRANSACTIONS-008"]
nfr: []
invariants: ["INV-007","INV-008","INV-012","INV-023","INV-029"]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["conversion","amend","reversal"]
error_code: null
preconditions:
  - "Conversión canónica posteada (revisión 1)"
  - "\"Banco BOB\" con saldo 685.00 BOB proveniente solo de esa conversión"
input: {"amend":{"target":"686.00 BOB","fee":"4.00 BOB PROVIDER","reason":"monto real según extracto"},"if_match":"versión vigente"}
steps:
  - "PUT /conversions/{id} con If-Match"
  - "Leer asientos de la transacción"
  - "Leer revisiones del detalle"
  - "Leer saldo de Banco BOB y la auditoría"
expected_result:
  - "Asiento de reversa que niega exactamente el original (5 postings)"
  - "Asiento nuevo: Wallet USDT −100.000000; FX_TRADING:USDT +100.000000; FX_TRADING:BOB −690.00; Banco BOB +686.00; Fees +4.00 BOB"
  - "Detalle revisión 2 activo con efectiva 6.86; revisión 1 (685.00 BOB) consultable"
  - "Saldo Banco BOB = 686.00 BOB"
  - "Un registro de auditoría con el motivo en la misma transacción"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONVERSION-010 — Corregir una conversión genera reversa, asiento nuevo y detalle nuevo conservando el anterior

## Intención

FR-TRANSACTIONS-024: corregir sin mutar historia (INV-007, INV-008).

## Escenario

```gherkin
Dada la conversión canónica con 685.00 BOB recibidos
Cuando la corrijo a 686.00 BOB recibidos con fee 4.00 BOB
Entonces se registra la reversa del asiento original y un asiento nuevo
  Y el detalle anterior sigue consultable
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
