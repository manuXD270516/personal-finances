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
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
status: automated
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
- **Hallazgos previos (D296, job `integration` de #162, PostgreSQL 18.6, 2026-10-23).** Con la política ANTERIOR, `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) ya devuelven vacío sin `PF002`. No se corrigen en el change 49: se propone un change de seguridad aparte (pendiente, docs/38).
- **Hallazgo de la fase b (observado en PostgreSQL 16 local, a confirmar en el job `integration`).** Con la forma V2 el contexto se evalúa como InitPlan al leer la primera fila (o al armar la condición de índice), no al planificar. Con la política anterior, `platform.current_workspace_id()` se evaluaba durante la planificación (estimación de la condición) y la consulta fallaba con `PF002` aunque la tabla estuviera vacía. Con V2 una lectura de una tabla SIN FILAS (o que no llega a evaluar ninguna) devuelve vacío en vez de `PF002` (en la prueba local, 52 de 300 operaciones en 33 tablas sobre una base sin datos: p. ej. lecturas de `ledger.entry_reversal`, `fx.exchange_rate`, `debt.credit_card_terms`; 51 pasan de `PF002` a vacío y la inserción por defecto en `fx.rate_anomaly_review` pasa de `PF002` a `23514`). Con al menos una fila en la tabla sigue fallando con `PF002`, y nunca se devuelve ni se escribe una fila de otro workspace. Esto contradice el escenario «el resultado es el mismo que con la política anterior» y el texto de docs/08 §PF002 («nunca devuelve 0 filas») para tablas vacías: requiere decisión del owner antes de fusionar (ver el informe de la fase b y docs/38).
