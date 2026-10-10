---
id: TC-REPORTING-UPCOMING-019
title: "Omitir una ocurrencia se refleja en la siguiente consulta con ventana, moneda y frescura declaradas"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Frescura y lectura inmediata de los próximos pagos"
scenario: "Ocurrencia omitida y consulta inmediata"
requirement_status: provisional
fr: ["FR-REPORTING-007","FR-REPORTING-016"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["freshness","etag"]
error_code: null
preconditions:
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Ocurrencias no resueltas \"Internet\" 199.00 BOB y \"Luz\" 180.00 BOB"
  - "ETag de una consulta previa"
input: {"days":30}
steps:
  - "Omitir \"Luz\""
  - "Consultar inmediatamente los próximos pagos con days=30 y el ETag previo en If-None-Match"
expected_result:
  - "200 (no 304) con solo Internet y total 199.00 BOB"
  - "meta: ventana 2026-10-20..2026-11-19, reportingCurrency BOB, generatedAt y dataFreshness"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-019 — Omitir una ocurrencia se refleja en la siguiente consulta con ventana, moneda y frescura declaradas

## Intención

Read-your-writes tras una acción del usuario: la lista se lee de la fuente de verdad y el ETag cambia.

## Escenario

```gherkin
Dada la lista con Internet y Luz
Cuando omito Luz y consulto de inmediato
Entonces la lista contiene solo Internet por 199.00 BOB
  Y la respuesta declara ventana, moneda, instante de generación y frescura
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
