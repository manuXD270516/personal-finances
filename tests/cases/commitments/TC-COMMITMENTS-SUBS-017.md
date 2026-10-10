---
id: TC-COMMITMENTS-SUBS-017
title: 'Una suscripción de otro workspace responde como inexistente'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Permisos, auditoría y aislamiento de suscripciones'
scenario: 'Suscripción de otro workspace'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012']
nfr: ['NFR-SEC-003']
invariants: ['INV-025']
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/test/integration/pg-subscriptions.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'rls', 'isolation']
error_code: 'RESOURCE_NOT_FOUND'
preconditions:
  - 'Workspaces A y B'
  - '"Streamly" en A'
input:
  actor: 'miembro de B'
steps:
  - 'GET W(B)/subscriptions/{id de A}'
  - 'Consulta SQL directa con contexto RLS de B a las cinco tablas'
expected_result:
  - '404 RESOURCE_NOT_FOUND'
  - 'Cero filas visibles en subscription, subscription_price, subscription_price_proposal, subscription_charge y subscription_reminder'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-017 — Una suscripción de otro workspace responde como inexistente

## Intención

Aislamiento por workspace con RLS forzada (ADR-0023).

## Escenario

```gherkin
Dado "Streamly" en el workspace A
Cuando un miembro de B la consulta
Entonces la respuesta es RESOURCE_NOT_FOUND
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
