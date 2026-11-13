---
id: TC-SECURITY-RLS-019
title: "El worker valora las tarjetas en moneda extranjera del dataset Demo v2 sin contexto de usuario"
spec: security/access-control
related_specs: ["identity/demo-data"]
requirement: "Los procesos del worker resuelven los ajustes del workspace sin usuario"
scenario: "Eventos y job de tarjetas sobre el dataset Demo v2"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-SEC-004]
invariants: []
priority: high
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/demo/demo-worker-context.int.test.ts
status: automated
regression_suite: true
phase: 8
tags: ["rls", "worker", "demo", "credit-cards"]
error_code: "PF002"
preconditions:
  - "PostgreSQL y almacenamiento mediante Testcontainers; API y worker reales"
  - "Dataset Demo v2 cargado con la ancla 2026-09-30 (tarjetas Kantuta en USD, moneda base BOB)"
input:
  consumer: "events.debt.card-activity"
  job: "debt.card-daily (envío manual)"
steps:
  - "Cargar el dataset Demo v2 y esperar a que el outbox se publique"
  - "Esperar a que events.debt.card-activity vacíe su cola y contar las entregas con PF002 en pgboss.job"
  - "Enviar debt.card-daily y leer el registro de cards processed del worker"
expected_result:
  - "Cero entregas del consumidor con PF002"
  - "El job registra failed = 0"
created: 2026-11-13
updated: 2026-11-13
---

# TC-SECURITY-RLS-019 — El worker valora las tarjetas en moneda extranjera del dataset Demo v2 sin contexto de usuario

## Intención

Valorar una cuenta en moneda distinta de la base obliga a FX a leer la moneda base del workspace. El worker no tiene usuario: debe leerla por el rol de directorio, no por la política de membresía.

## Escenario

```gherkin
Dado el dataset Demo v2 cargado, con tarjetas en USD y moneda base BOB
Cuando el worker procesa los eventos de la carga y se ejecuta el job diario de tarjetas
Entonces el consumidor de actividad de tarjetas no tiene entregas fallidas por PF002
  Y el job diario termina con failed = 0
```

## Notas

- Change `fix-worker-user-context`. Rojo previo en `main`: 8 entregas con PF002 y 1 fallo del job (2026-11-13).
