---
id: TC-IMPORTS-CSV-023
title: "La aprobación crea gastos e ingresos posteados sin categoría con origen import y deja el saldo en 11964.00 BOB"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording","ledger/journal-posting","audit/audit-trail"]
requirement: "Aprobación y creación de las transacciones"
scenario: "Aprobación con filas omitidas e inválidas"
requirement_status: confirmed
fr: ["FR-IMPORTS-003","FR-IMPORTS-001"]
nfr: ["NFR-DATA-016"]
invariants: ["INV-004","INV-005","INV-014","INV-029"]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/transactions/src/application/imported-transactions.adapter.test.ts
status: automated
regression_suite: true
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"rows":5,"toCreate":3}
steps:
  - "Vista previa: 2 cafés NEW (-18.00), sueldo NEW (+8000.00), supermercado DUPLICATE_PROBABLE con SKIP, 1 fila INVALID"
  - "POST approve (202)"
  - "Esperar el fin de la persistencia (polling GET W/imports/{id})"
  - "Repetir la aprobación con la misma Idempotency-Key"
expected_result:
  - "2 gastos POSTED de 18.00 BOB (UNCATEGORIZED) y 1 ingreso POSTED de 8000.00 BOB (UNCATEGORIZED_INCOME), source IMPORT, import_job_id"
  - "Cada uno con asiento balanceado por moneda, auditoría origin import y recorrido de creación"
  - "Saldo contable de Banco BOB = 11964.00 BOB"
  - "Job COMPLETED: total 5, creadas 3, omitidas 1, inválidas 1"
  - "Replay: misma respuesta y ninguna transacción adicional"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-023 — La aprobación crea gastos e ingresos posteados sin categoría con origen import y deja el saldo en 11964.00 BOB

## Intención

El resultado financiero del import: transacciones reales en el ledger, solo las aprobadas, idempotente.

## Escenario

```gherkin
Dada la vista previa de 5 filas con 3 a crear
Cuando apruebo y termina la persistencia
Entonces existen 2 gastos de 18.00 BOB y 1 ingreso de 8000.00 BOB sin categoría
  Y el saldo de Banco BOB es 11964.00 BOB
```

## Notas

- Cubre también el scenario "Aprobación repetida con la misma clave".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
