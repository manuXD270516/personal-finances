---
id: TC-COMMITMENTS-RECUR-036
title: 'El comprometido de octubre suma ocurrencias no resueltas y pendientes sin doble conteo'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Total comprometido del periodo financiero'
scenario: 'Comprometido de octubre'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-011']
nfr: []
invariants: ['INV-001']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/committed.test.ts
  - tests/e2e/specs/recurring.spec.ts
status: automated
regression_suite: true
phase: 3
tags: ['recurrence', 'committed', 'q4']
error_code: null
preconditions:
  - 'Periodo 2026-10 (2026-10-01..31), hoy 2026-10-09'
  - 'Internet 199.00 BOB (20), Luz ESTIMATED 150.00 BOB (25), Gimnasio MIN_MAX 100.00..180.00 BOB (28) sin resolver'
  - 'Gasto PENDING manual de 250.00 BOB del 2026-10-12'
  - 'Alquiler 3500.00 BOB del 2026-10-05 materializado POSTED; Sueldo INCOME 9000.00 BOB del 2026-10-30'
input:
  periodId: '2026-10'
steps:
  - 'GetCommitted(periodo 2026-10)'
expected_result:
  - 'byCurrency BOB total 779.00 BOB (occurrences 529.00 + pending 250.00)'
  - 'expectedIncome 9000.00 BOB'
  - 'El Alquiler no suma'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-036 — El comprometido de octubre suma ocurrencias no resueltas y pendientes sin doble conteo

## Intención

FR-COMMITMENTS-011 / Q4: total comprometido explicable.

## Escenario

```gherkin
Dado el periodo "2026-10" con Internet, Luz y Gimnasio sin resolver y un gasto pendiente de 250.00 BOB
Cuando se calcula el comprometido
Entonces es 779.00 BOB
  Y el "Sueldo" de 9000.00 BOB se informa como ingreso esperado
```

## Notas

- Cifras a mano: 199.00 + 150.00 + 180.00 + 250.00 = 779.00.
