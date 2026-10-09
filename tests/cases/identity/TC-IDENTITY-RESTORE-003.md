---
id: TC-IDENTITY-RESTORE-003
title: "Una verificación fallida de la importación no deja ningún workspace visible"
spec: identity/workspace-portability
related_specs: []
requirement: "La ida y vuelta reproduce saldos e historia"
scenario: "Verificación fallida"
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-REL-014]
invariants: [INV-022]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-import.api.test.ts","packages/contexts/identity/src/application/portability/workspace-import.service.test.ts","packages/contexts/identity/src/domain/export-manifest.test.ts","packages/contexts/identity/src/domain/workspace-export.test.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["restore", "atomic"]
error_code: "EXPORT_VERIFICATION_FAILED"
preconditions:
  - "Export válido de \"W1\""
  - "Importer de ledger con defecto inyectado que omite un posting de \"Bank A\""
input:
  inject: "omitir un posting"
steps:
  - "Importar"
  - "Listar workspaces de U1 y contar filas con el workspace_id candidato"
expected_result:
  - "La importación termina FAILED con EXPORT_VERIFICATION_FAILED"
  - "No hay workspace nuevo visible ni filas con su workspace_id (rollback)"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-003 — Una verificación fallida de la importación no deja ningún workspace visible

## Intención

La verificación contra el manifiesto es la garantía de la ida y vuelta.

## Escenario

```gherkin
Dado una importación en la que el saldo calculado de una cuenta no coincide con el manifiesto
Cuando termina la verificación
Entonces la importación falla con "EXPORT_VERIFICATION_FAILED"
  Y no queda ningún workspace nuevo visible
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
