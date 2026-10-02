---
id: TC-<CONTEXT>-<FEATURE>-NNN
title: <Oración corta en español que describe el comportamiento verificado>
spec: <context>/<capability>            # ARCHITECTURE §14, p. ej. ledger/journal-posting
related_specs: []
requirement: <Nombre exacto del ### Requirement (en español)>
scenario: null                          # nombre exacto del #### Scenario cuando existan las specs
requirement_status: provisional         # provisional | confirmed
fr: [FR-<CONTEXT>-NNN]
nfr: []
invariants: []                          # INV-001..INV-020 (docs/09-ledger-design.md)
priority: high                          # critical | high | medium | low
type: domain                            # unit | domain | property | integration | api | e2e | security | platform
level: domain                           # ver docs/17-test-traceability.md §4.1
automation_status: not_automated        # not_automated | automated | manual
automated_tests: []
status: draft                           # draft | ready | automated | deprecated
regression_suite: false
phase: 1
tags: []
error_code: null                        # código de dominio RFC 9457 cuando el caso espera un rechazo
preconditions:
  - <estado que debe existir antes del test>
input:
  <key>: <value>                        # montos SIEMPRE como strings decimales, p. ej. "300.00"
steps:
  - <acción>
expected_result:
  - <resultado observable>
created: 2026-10-01
updated: 2026-10-01
---

# TC-<CONTEXT>-<FEATURE>-NNN — <title>

## Intención

<Por qué existe este caso: qué regla o invariante protege y qué saldría mal sin él.>

## Escenario

```gherkin
Dado <precondición>
  Y <precondición>
Cuando <acción>
Entonces <resultado>
  Y <resultado>
```

## Notas

- <Casos borde, origen de los datos (perfil de seed / object mother), enlaces a TCs relacionados.>
