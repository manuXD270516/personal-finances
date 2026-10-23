---
id: TC-SECURITY-RLS-007
title: "Sin contexto, cada tabla registrada responde igual con la política reescrita que con la anterior y ninguna devuelve filas"
spec: security/access-control
related_specs: []
requirement: "Reescritura de las políticas de aislamiento sin pérdida de aislamiento"
scenario: "Sin contexto el resultado es el mismo que con la política anterior"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 5
tags: ["rls", "fail-closed", "policy-rewrite"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed"
  - "Conexión con el rol pf_app sin app.workspace_id fijado"
input:
  tables: "todas las de platform.workspace_scoped_table"
  operations: ["lectura filtrada por un workspace existente", "lectura sin filtro", "inserción"]
steps:
  - "Para cada tabla y operación, ejecutar con la política anterior (en una transacción que la restaura) y registrar el resultado"
  - "Repetir con la política reescrita"
expected_result:
  - "Cada operación que fallaba con PF002 sigue fallando con PF002"
  - "Ninguna operación devuelve filas de negocio"
  - "Toda operación que con la política anterior ya devolvía vacío sin PF002 queda listada como hallazgo y no empeora"
created: 2026-10-21
updated: 2026-10-23
---

# TC-SECURITY-RLS-007 — Sin contexto, cada tabla registrada responde igual con la política reescrita que con la anterior y ninguna devuelve filas

## Intención

Una política con `(SELECT platform.current_workspace_id())` se evalúa como InitPlan, de forma diferida: si la consulta no lee ninguna fila, la función puede no ejecutarse y no lanzar `PF002`. Este caso demuestra, tabla por tabla, que la reescritura no debilita el fail-closed.

## Escenario

```gherkin
Dada una transacción sin workspace fijado
Cuando se lee y se inserta en cada tabla registrada, con la política anterior y con la reescrita
Entonces cada operación que fallaba con PF002 sigue fallando igual
  Y ninguna devuelve filas de negocio
```

## Notas

- Change `optimize-rls-policy-overhead` (D287). Si la política anterior ya tiene un hueco (vacío sin `PF002`), se registra como hallazgo en estas notas y en docs/38 y se corrige en un change de seguridad aparte (D296 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)); este TC solo exige que la política nueva no empeore.
