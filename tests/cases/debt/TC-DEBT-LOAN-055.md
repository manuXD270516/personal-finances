---
id: TC-DEBT-LOAN-055
title: "La lista de préstamos lee cronogramas y pagos en una consulta por tipo, no una por préstamo"
spec: debt/loans
related_specs: []
requirement: "Detalle y estado del préstamo"
scenario: "Detalle tras la primera cuota"
requirement_status: confirmed
fr: ["FR-DEBT-007"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/application/loans.queries.list.test.ts
  - packages/contexts/debt/test/integration/pg-debt.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["loans","list","n-plus-one","fix-debt-cards-loans-gaps"]
error_code: null
preconditions:
  - "Tres préstamos: dos activos con cronograma y un borrador"
input: {"loans": 3}
steps:
  - "Listar los préstamos y contar las consultas al repositorio de cronogramas y de pagos"
  - "Comparar la lectura en lote con la lectura por préstamo en PostgreSQL"
expected_result:
  - "Una consulta de cuotas y una de pagos para toda la lista"
  - "Las cifras de cada fila (principal pendiente, próxima cuota y atraso) no cambian"
  - "La lectura en lote es igual a la lectura por préstamo, cada uno a su versión"
created: 2026-11-25
updated: 2026-11-25
---

# TC-DEBT-LOAN-055 — La lista de préstamos lee cronogramas y pagos en una consulta por tipo, no una por préstamo

## Intención

Cierra el resto de D222 (lista sin N+1) del lado de la base de datos: la lista hacía 2 consultas por préstamo.

## Escenario

```gherkin
Dado tres préstamos, dos con cronograma vigente
Cuando se listan
Entonces se hace una lectura en lote de cuotas y una de pagos, con las mismas cifras que el detalle
```
