---
id: TC-IDENTITY-EXPORT-009
title: "Todo el ciclo de un export queda auditado en orden"
spec: identity/workspace-portability
related_specs: ["audit/audit-trail"]
requirement: "Auditoría de exportaciones e importaciones"
scenario: "Ciclo auditado de un export"
requirement_status: confirmed
fr: [FR-AUDIT-005, FR-AUDIT-001, FR-IDENTITY-010]
nfr: []
invariants: [INV-029]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["export", "audit"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
input:
  steps: ["request","complete","download","download","expire"]
steps:
  - "Solicitar, terminar, descargar dos veces y expirar"
  - "GET W/audit-log?aggregateType=WorkspaceExport&aggregateId={id}"
expected_result:
  - "Cinco registros en orden: identity.export.requested, identity.export.completed, identity.export.downloaded ×2, identity.export.expired"
  - "Ninguno contiene contenido exportado"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-009 — Todo el ciclo de un export queda auditado en orden

## Intención

FR-AUDIT-005: la exportación de datos es evento de seguridad.

## Escenario

```gherkin
Dado un export solicitado, descargado dos veces y vencido
Cuando se consulta su auditoría
Entonces contiene en orden solicitud, finalización, dos descargas y expiración
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
