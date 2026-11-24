---
id: TC-PLATFORM-DRILL-010
title: "El drill trimestral fuera del host queda en el runbook con sus verificaciones y el RTO observado"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Drill fuera del host cada trimestre"
scenario: "Drill trimestral registrado"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-002","NFR-REL-005"]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","runbook","add-host-restore-drill"]
error_code: null
preconditions:
  - "docs/runbooks/deploy-and-restore.md §6 actualizado por el change"
  - "VM efímera drill_enabled=true y clave de solo lectura"
input: {"procedure":"deploy-and-restore.md §6"}
steps:
  - "Revisar que §6 diga trimestral, enlace el drill automático y aclare que el del host no cubre un host comprometido"
  - "Ejecutar el procedimiento en el primer trimestre con datos reales"
expected_result:
  - "El registro tiene inicio y fin, RTO observado, tamaño restaurado y el resultado de las consultas de integridad"
  - "La VM y su volumen quedan destruidos al final"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-010 — El drill trimestral fuera del host queda en el runbook con sus verificaciones y el RTO observado

## Intención

Requirement «Drill fuera del host cada trimestre» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el procedimiento trimestral del runbook
Cuando el owner lo ejecuta
Entonces queda registrado el RTO observado y el resultado de las verificaciones
```

## Notas

- Procedimiento manual del owner (D456); el TC no se automatiza en CI.
