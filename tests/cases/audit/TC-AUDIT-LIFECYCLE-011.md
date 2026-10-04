---
id: TC-AUDIT-LIFECYCLE-011
title: "Las transiciones previas se reconstruyen desde la auditoría marcadas como derivadas"
spec: audit/lifecycle-timeline
related_specs: ["audit/audit-trail"]
requirement: "Transiciones previas reconstruidas desde la auditoría"
scenario: "Gasto anterior al registro de transiciones"
requirement_status: confirmed
fr: ["FR-AUDIT-012","FR-AUDIT-004"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - apps/web/src/ui/lifecycle/lifecycle.test.tsx
  - packages/contexts/audit/src/application/lifecycle.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","backfill"]
error_code: null
preconditions:
  - "Gasto de 60.00 BOB creado posteado y anulado antes de la migración, con su auditoría (created, voided)"
  - "Otro gasto cuyo primer registro de auditoría es una edición (sin creación)"
input: {"job":"audit.lifecycle-backfill"}
steps:
  - "Ejecutar el backfill dos veces"
  - "Consultar ambos recorridos"
expected_result:
  - "Gasto 1: RECORD (∅ → posted) y VOID (posted → void), ambas derived = true, historyComplete true"
  - "Gasto 2: historyComplete false, sin transiciones inventadas"
  - "La segunda ejecución no duplica filas"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-011 — Las transiciones previas se reconstruyen desde la auditoría marcadas como derivadas

## Intención

Los datos anteriores a D37 también tienen recorrido, pero nunca uno inventado.

## Escenario

```gherkin
Dado un gasto anterior al registro de transiciones con auditoría de creación y anulación
Cuando se reconstruye su recorrido
Entonces muestra registrar y anular marcadas como derivadas
```

## Notas
- Implementación (2026-10-04): el job `audit.lifecycle-backfill` deriva los registros de auditoría aún no respaldados por ninguna fila del recorrido; el recorrido se ordena por instante y secuencia, así que una transición derivada queda antes de las vivas posteriores.
