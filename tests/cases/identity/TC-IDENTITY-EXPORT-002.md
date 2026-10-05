---
id: TC-IDENTITY-EXPORT-002
title: "El export no contiene secretos, sesiones, claves de idempotencia ni hashes de IP"
spec: identity/workspace-portability
related_specs: ["audit/audit-trail"]
requirement: "Contenido completo del export"
scenario: "Sin secretos en el export"
requirement_status: provisional
fr: [FR-IDENTITY-010]
nfr: [NFR-COMP-002, NFR-SEC-015]
invariants: []
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["export", "privacy"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
  - "Sesión BFF activa, claves de idempotencia y mensajes de outbox recientes"
  - "Registros de auditoría con client_ip_hash"
input:
  export: "W1"
steps:
  - "Exportar y descomprimir"
  - "Buscar tokens, cookies, valores de idempotency_key, filas de outbox y client_ip_hash"
expected_result:
  - "Ninguna coincidencia"
  - "Las secciones de auditoría no incluyen client_ip_hash"
created: 2026-10-05
updated: 2026-10-05
---

# TC-IDENTITY-EXPORT-002 — El export no contiene secretos, sesiones, claves de idempotencia ni hashes de IP

## Intención

Minimización: el export lleva datos de negocio, nunca material de autenticación.

## Escenario

```gherkin
Dado "W1" con sesiones, claves de idempotencia y outbox
Cuando se inspecciona su export
Entonces no contiene tokens, cookies, claves de idempotencia, outbox ni hashes de IP
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
