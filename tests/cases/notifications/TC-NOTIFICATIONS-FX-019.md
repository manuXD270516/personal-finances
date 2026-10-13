---
id: TC-NOTIFICATIONS-FX-019
title: "El aviso agrupado se muestra en portugués con plural y formato pt-BR"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Aviso agrupado en portugués"
requirement_status: provisional
fr: ["FR-NOTIFY-002"]
nfr: ["NFR-USAB-001", "NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "i18n"]
error_code: null
preconditions:
  - "EDITOR con locale pt-BR; aviso v2 de USDT/BOB con 3 muestras pendientes y mayor variación +6.6116 %"
input: {"locale": "pt-BR", "pendingCount": 3}
steps:
  - "Renderizar el aviso in-app en pt-BR, es y en"
expected_result:
  - "El texto está en portugués con el plural de 3 muestras y la variación +6,61 %"
  - "es y en tienen sus textos y plurales; 1 muestra usa el singular"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-019 — El aviso agrupado se muestra en portugués con plural y formato pt-BR

## Intención

NFR-USAB-001: textos del mensaje v2 en es, en y pt con plural ICU.

## Escenario

```gherkin
Dado el EDITOR con locale pt-BR
Cuando recibe el aviso de 3 muestras
Entonces lo ve en portugués con plural
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
