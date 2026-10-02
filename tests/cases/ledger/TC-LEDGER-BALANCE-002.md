---
id: TC-LEDGER-BALANCE-002
title: "La restricción diferida de la base de datos rechaza un asiento desbalanceado al hacer commit"
spec: ledger/journal-posting
related_specs: []
requirement: "Asientos balanceados por moneda"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-001]
nfr: []
invariants: [INV-004]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["ledger", "database", "defense-in-depth"]
error_code: null
preconditions:
  - "PostgreSQL 18 vía Testcontainers con todas las migraciones aplicadas"
  - "La conexión usa el rol de aplicación pf_app (sin BYPASSRLS, no es dueño de las tablas)"
  - "SET LOCAL app.workspace_id = W1"
input:
  unbalanced: ["+50.00 BOB (EXPENSE:BOB)", "-49.00 BOB (Bank A)"]
  balanced: ["+50.00 BOB (EXPENSE:BOB)", "-50.00 BOB (Bank A)"]
steps:
  - "BEGIN; insertar el journal_entry y los postings desbalanceados vía SQL directo; COMMIT"
  - "BEGIN; insertar el journal_entry y los postings balanceados, insertando el segundo posting después del primero (estado intermedio desbalanceado); COMMIT"
expected_result:
  - "El primer COMMIT falla con el error del constraint trigger (mapeado a LEDGER_UNBALANCED_ENTRY) y no se persiste nada"
  - "El segundo COMMIT tiene éxito: el trigger diferido solo se evalúa al momento del commit"
  - "Un SELECT muestra exactamente el asiento balanceado"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-BALANCE-002 — La restricción diferida de la base de datos rechaza un asiento desbalanceado al hacer commit

## Intención

La base de datos defiende INV-004 de forma independiente de la aplicación (ARCHITECTURE §4.1: constraint trigger diferido).

## Escenario

```gherkin
Dado una sesión de base de datos con el rol "pf_app" en el workspace "W1"
Cuando se hace commit de un asiento con los postings "+50.00 BOB" y "-49.00 BOB"
Entonces el commit falla
  Y no existen filas en ledger.journal_entry ni en ledger.posting para ese asiento
```
