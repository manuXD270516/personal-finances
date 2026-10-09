---
id: TC-IDENTITY-EXPORT-004
title: "El export refleja una instantánea consistente aunque haya escrituras concurrentes"
spec: identity/workspace-portability
related_specs: ["ledger/balances"]
requirement: "Instantánea consistente del export"
scenario: "Gasto registrado durante la exportación"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
nfr: [NFR-REL-014]
invariants: [INV-022]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export-lifecycle.api.test.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["export", "consistency"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
input:
  concurrent: {"expense":"20.00","account":"Bank A"}
steps:
  - "Iniciar el export y pausarlo después de tomar la instantánea (hook de test)"
  - "Registrar un gasto de 20.00 BOB en \"Bank A\""
  - "Reanudar y terminar el export"
expected_result:
  - "El export no contiene el gasto de 20.00 BOB ni sus asientos"
  - "manifest.verification informa \"Bank A\" 3099.10 BOB"
  - "El balance de comprobación del manifiesto suma 0 por moneda"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-004 — El export refleja una instantánea consistente aunque haya escrituras concurrentes

## Intención

REPEATABLE READ en una única transacción: el export nunca mezcla estados.

## Escenario

```gherkin
Dado el export de "W1" con la instantánea tomada con "Bank A" en 3099.10 BOB
Cuando el usuario registra un gasto de 20.00 BOB mientras se escribe el archivo
Entonces el export no contiene ese gasto
  Y su manifiesto informa "Bank A" con 3099.10 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
