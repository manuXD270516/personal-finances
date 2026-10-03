---
id: TC-AUDIT-ACTOR-001
title: "Una mutación hecha por un proceso del sistema se audita con actor de sistema y conserva la correlación"
spec: audit/audit-trail
related_specs: ["ledger/journal-posting"]
requirement: "Atribución de mutaciones automáticas"
scenario: "Mutación hecha por un proceso interno"
requirement_status: confirmed
fr: [FR-AUDIT-002]
nfr: []
invariants: [INV-029]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/audit/src/domain/audit-record.test.ts
  - packages/contexts/audit/src/application/audit-recorder.test.ts
  - packages/contexts/audit/test/integration/pg-audit-log.int.test.ts
  - packages/platform/src/nest/request-context.middleware.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["audit", "worker"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers"
  - "Workspace W1 sin cuenta contable de sistema para USDT"
  - "Solicitud original con correlationId C7"
input:
  command: "Registrar 100.000000 USDT que provoca la creación de la cuenta contable de sistema USDT por un proceso interno"
steps:
  - "Ejecutar el comando"
  - "Leer los registros de auditoría con correlationId C7"
expected_result:
  - "El registro de la mutación automática tiene actor_type SYSTEM o WORKER con un nombre de proceso no vacío y sin actor_user_id"
  - "El registro conserva correlationId C7"
  - "Un registro de actor USER sin userId o de actor SYSTEM sin proceso es rechazado por el dominio y por la base de datos"
created: 2026-10-02
updated: 2026-10-03
---

# TC-AUDIT-ACTOR-001 — Una mutación hecha por un proceso del sistema se audita con actor de sistema y conserva la correlación

## Intención

Las mutaciones de jobs, reglas, recurrentes e imports deben ser atribuibles (FR-AUDIT-002) sin hacerse pasar por un usuario.

## Escenario

```gherkin
Dado una solicitud con correlación "C7" que dispara un proceso interno
Cuando el proceso crea la cuenta contable de sistema para USDT
Entonces el registro de auditoría identifica un actor de sistema con su proceso
  Y conserva la correlación "C7"
```

## Notas

- Automatización (add-audit-trail): La creación de la cuenta contable de sistema USDT se simula con un proceso `ledger.system-accounts` (contexto ambiental SYSTEM y consumidor real del worker) hasta `add-ledger-core`.
