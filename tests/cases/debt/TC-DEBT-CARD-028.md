---
id: TC-DEBT-CARD-028
title: 'Permisos, auditoría y aislamiento de las tarjetas'
spec: debt/credit-cards
related_specs: []
requirement: 'Permisos, auditoría y aislamiento de las tarjetas'
scenario: 'VIEWER intenta cambiar el límite'
requirement_status: confirmed
fr: ['FR-DEBT-012', 'FR-AUDIT-001']
nfr: ['NFR-SEC-003']
invariants: ['INV-025', 'INV-029']
priority: critical
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
  - packages/contexts/debt/test/integration/pg-cards.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'rbac', 'rls']
error_code: INSUFFICIENT_ROLE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Miembros VIEWER y EDITOR; workspace B con otro miembro'
input:
  viewer: 'límite 20000.00 BOB'
  editor: 'límite 12000.00 BOB'
steps:
  - 'VIEWER cambia el límite'
  - 'EDITOR cambia el límite'
  - 'Miembro de B consulta "Visa Oro"'
expected_result:
  - 'VIEWER: 403 INSUFFICIENT_ROLE y el límite sigue en 10000.00 BOB'
  - 'EDITOR: auditoría con 10000.00 → 12000.00 BOB'
  - 'B: 404 RESOURCE_NOT_FOUND'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-028 — Permisos, auditoría y aislamiento de las tarjetas

## Intención

RBAC + RLS + auditoría síncrona (INV-029).

## Escenario

```gherkin
Dado "Visa Oro" con límite 10000.00 BOB
Cuando un VIEWER intenta cambiarlo
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Cubre "Cambio de límite auditado" y "Tarjeta de otro workspace".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
