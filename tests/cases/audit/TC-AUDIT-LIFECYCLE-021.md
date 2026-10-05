---
id: TC-AUDIT-LIFECYCLE-021
title: "El CSV del recorrido de un gasto tiene una fila por transición con hora local y montos exactos"
spec: audit/lifecycle-timeline
related_specs: ["transactions/transaction-recording"]
requirement: "Exportación del recorrido en CSV"
scenario: "Exportar a CSV el recorrido de un gasto"
requirement_status: confirmed
fr: ["FR-AUDIT-013", "FR-AUDIT-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "export", "api"]
error_code: null
preconditions:
  - "\"Bank A\" con 1000.00 BOB; TZ del workspace America/La_Paz"
  - "FixedClock 2026-03-10T10:00:00-04:00, avanzando 1 h por paso"
  - "Gasto de 80.00 BOB: RECORD pending, POST, CLEAR, REVISE a 85.00 BOB, VOID motivo \"duplicado\""
input: {"request": "GET W/transactions/{transactionId}/lifecycle/export?format=csv"}
steps:
  - "Exportar el recorrido a CSV"
expected_result:
  - "200 text/csv; charset=utf-8 con Content-Disposition attachment"
  - "Encabezado + 5 filas en orden: RECORD, POST, CLEAR, REVISE (revisionFrom 1, revisionTo 2, monto 85.00 BOB), VOID (motivo \"duplicado\")"
  - "occurredAt de la primera fila 2026-03-10T10:00:00-04:00 y las siguientes cada 1 h, todas con desfase -04:00"
  - "Montos como texto decimal exacto con su moneda (85.00 y BOB), sin separador de miles"
  - "El recorrido no cambia tras exportar"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-021 — El CSV del recorrido de un gasto tiene una fila por transición con hora local y montos exactos

## Intención

El recorrido se puede sacar del sistema para revisarlo o archivarlo (D52).

## Escenario

```gherkin
Dado un gasto registrado, posteado, confirmado, corregido y anulado
Cuando exporto su recorrido a CSV
Entonces obtengo cinco filas en orden con hora de La Paz y montos exactos
```

## Notas

- Mismos datos que TC-AUDIT-LIFECYCLE-005.
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
