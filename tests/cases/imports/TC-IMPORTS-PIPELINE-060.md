---
id: TC-IMPORTS-PIPELINE-060
title: "Una transacción reconciliada bloquea el deshacer completo con IMPORT_REVERT_BLOCKED"
spec: imports/import-pipeline
related_specs: []
requirement: "Deshacer un import"
scenario: "Transacción reconciliada bloquea el deshacer"
requirement_status: provisional
fr: ["FR-IMPORTS-012", "FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-008"]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imported-movements.api.test.ts
  - apps/web/src/ui/imports/pipeline-logic.test.ts
  - packages/contexts/imports/src/domain/row-edits.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.lifecycle.test.ts
  - packages/contexts/ledger/src/application/ledger.service.test.ts
  - packages/contexts/transactions/src/application/record-imported-transactions.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_REVERT_BLOCKED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Transacción reconciliada bloquea el deshacer\" del delta de add-import-pipeline"
steps:
  - "el ingreso de 8000.00 BOB de esa importación está reconciliado y la EDITOR pide deshacerla"
expected_result:
  - "se rechaza con `IMPORT_REVERT_BLOCKED` indicando 1 fila bloqueada"
  - "ninguna de las 3 transacciones se anula"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-060 — Una transacción reconciliada bloquea el deshacer completo con IMPORT_REVERT_BLOCKED

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder deshacer una importación terminada: el sistema DEBE (MUST) mostrar antes cuántas transacciones se anularán y cuáles están bloqueadas, y al confirmar DEBE (MUST) anular con su reversa cada transacción no anulada que la importación creó, sin borrar nada, con auditoría y de forma idempotente.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el ingreso de 8000.00 BOB de esa importación está reconciliado y la EDITOR pide deshacerla
Entonces se rechaza con `IMPORT_REVERT_BLOCKED` indicando 1 fila bloqueada
  Y ninguna de las 3 transacciones se anula
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
