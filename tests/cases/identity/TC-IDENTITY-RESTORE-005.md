---
id: TC-IDENTITY-RESTORE-005
title: "La importación preserva revisiones, reversas y recorridos de las transacciones"
spec: identity/workspace-portability
related_specs: ["audit/lifecycle-timeline", "ledger/journal-posting"]
requirement: "La ida y vuelta reproduce saldos e historia"
scenario: "Revisiones y reversas preservadas"
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-REL-014]
invariants: [INV-007, INV-008]
priority: high
type: integration
level: application
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export.api.test.ts","packages/contexts/identity/src/domain/id-remap.test.ts"]
status: automated
regression_suite: true
phase: 2
tags: ["restore", "history"]
error_code: null
preconditions:
  - "En \"W1\" un gasto de 150.00 BOB se corrigió a 155.00 BOB (revisión 2: asiento revertido, reversa y asiento nuevo)"
input:
  roundTrip: true
steps:
  - "Exportar e importar"
  - "Consultar el gasto restaurado, sus asientos y su recorrido"
expected_result:
  - "Revisión 2 con los mismos tres asientos y fechas"
  - "Recorrido: RECORD y REVISE en el mismo orden con los asientos remapeados"
  - "Diffs de auditoría con ids remapeados de forma consistente"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-005 — La importación preserva revisiones, reversas y recorridos de las transacciones

## Intención

La historia inmutable (INV-007/008) también viaja: el import inserta, no re-ejecuta comandos.

## Escenario

```gherkin
Dado un gasto corregido de 150.00 BOB a 155.00 BOB en "W1"
Cuando se exporta e importa
Entonces el gasto restaurado tiene revisión 2 y los mismos tres asientos
  Y su recorrido muestra registrar y revisar en el mismo orden
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
