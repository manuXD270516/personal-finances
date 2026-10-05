---
id: TC-AUDIT-LIFECYCLE-023
title: "El PDF del recorrido de una cuenta muestra estado actual, camino y línea de tiempo"
spec: audit/lifecycle-timeline
related_specs: ["accounts/account-management"]
requirement: "Exportación del recorrido en PDF"
scenario: "Exportar a PDF el recorrido de una cuenta"
requirement_status: confirmed
fr: ["FR-AUDIT-013", "FR-AUDIT-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "export", "api"]
error_code: null
preconditions:
  - "\"Bank C\" abierta con saldo inicial 500.00 BOB, archivada con motivo \"sin uso\", reactivada, saldo transferido y cerrada con fecha 2026-03-31; TZ America/La_Paz"
input: {"request": "GET W/accounts/{bankCId}/lifecycle/export?format=pdf"}
steps:
  - "Exportar el recorrido a PDF"
  - "Extraer el texto del PDF"
expected_result:
  - "200 application/pdf con Content-Disposition attachment"
  - "El texto identifica \"Bank C\" y el estado actual CLOSED"
  - "Secuencia de estados ACTIVE, ARCHIVED, ACTIVE, CLOSED"
  - "Línea de tiempo: abrir (asiento de 500.00 BOB), archivar (motivo \"sin uso\"), reactivar y cerrar, con actor y fecha en hora de La Paz"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-023 — El PDF del recorrido de una cuenta muestra estado actual, camino y línea de tiempo

## Intención

El recorrido se puede compartir o archivar como documento legible (D52).

## Escenario

```gherkin
Dada "Bank C" abierta, archivada, reactivada y cerrada
Cuando exporto su recorrido a PDF
Entonces el PDF muestra su estado actual, su camino y su línea de tiempo
```

## Notas

- Mismos datos que TC-AUDIT-LIFECYCLE-009. El diagrama en el PDF es opcional (PUEDE).
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
