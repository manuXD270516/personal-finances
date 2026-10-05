---
id: TC-AUDIT-LIFECYCLE-020
title: "El Recorrido de una categoría destaca su camino y ofrece exportar en CSV y PDF"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories"]
requirement: "Reporte visual del recorrido en la UI"
scenario: "Recorrido de una categoría en la UI"
requirement_status: confirmed
fr: ["FR-AUDIT-011", "FR-AUDIT-013"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle-export.api.test.ts
  - apps/web/src/ui/classification/classification.test.tsx
  - apps/web/src/ui/lifecycle/lifecycle.test.tsx
  - apps/web/test/integration/bff.int.test.ts
  - tests/e2e/specs/lifecycle.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle", "ui", "classification"]
error_code: null
preconditions:
  - "Categoría \"Supermercado\" creada, archivada y desarchivada; TZ America/La_Paz"
input: {"page": "categorías › Supermercado › Recorrido"}
steps:
  - "Abrir el recorrido de \"Supermercado\""
expected_result:
  - "El diagrama destaca ACTIVE y ARCHIVED con archivar (1) y desarchivar (2) numeradas"
  - "ACTIVE aparece como estado actual (texto \"(actual)\", no solo color)"
  - "La línea de tiempo lista crear, archivar y desarchivar con actor y fecha en hora de La Paz"
  - "Hay acciones \"Exportar CSV\" y \"Exportar PDF\" que descargan el recorrido"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-020 — El Recorrido de una categoría destaca su camino y ofrece exportar en CSV y PDF

## Intención

Las categorías y contrapartes tienen el mismo reporte visual que transacciones y cuentas (D52).

## Escenario

```gherkin
Dada "Supermercado" archivada y desarchivada
Cuando abro su Recorrido
Entonces veo el camino destacado y la línea de tiempo
  Y puedo exportarlo en CSV y PDF
```

## Notas

- Contrapartes: mismo componente; el E2E puede cubrir una de las dos y la otra en test de componente.
- Decisión del owner docs/31 D52 (2026-10-05). Automatizado en las tareas 9.x de add-lifecycle-timeline.
