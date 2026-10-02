---
id: TC-TRANSACTIONS-CONVERSION-008
title: "El detalle de la conversión canónica expone todos sus campos y no admite modificación"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing"]
requirement: "Detalle de la conversión inmutable"
scenario: "Consultar el detalle del ejemplo canónico"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-022"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-012"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["conversion","immutability"]
error_code: null
preconditions:
  - "Conversión canónica registrada el 2026-09-30 con referencia R2 = 6.95 y proveedor \"Binance P2P\""
input: {"direct_update":"UPDATE del detalle con el rol de aplicación","read":"GET /conversions/{id}"}
steps:
  - "Leer la conversión"
  - "Intentar UPDATE/DELETE directo del detalle con el rol de aplicación"
expected_result:
  - "Detalle: entregado 100.000000 USDT; convertido 100.000000 USDT; bruto destino 690.00 BOB; neto 685.00 BOB; cotizada 6.90; efectiva 6.850000000000000000; fee PROVIDER 5.00 BOB; referencia 6.95 (R2); spread 0.719424460431654676 % y 5.00 BOB; proveedor; executedAt"
  - "UPDATE y DELETE fallan por falta de privilegio; el detalle no cambia"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONVERSION-008 — El detalle de la conversión canónica expone todos sus campos y no admite modificación

## Intención

FR-TRANSACTIONS-022 / NFR-DATA-006: el detalle es un hecho histórico; solo se reemplaza por una nueva revisión.

## Escenario

```gherkin
Dada la conversión canónica registrada
Cuando consulto su detalle
Entonces veo montos, tasas, fee, referencia, spread y proveedor
  Y ninguna operación puede modificarlo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
