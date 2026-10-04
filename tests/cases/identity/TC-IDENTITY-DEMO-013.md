---
id: TC-IDENTITY-DEMO-013
title: "La auditoría de carga y limpieza queda en el workspace de origen y sobrevive a la purga"
spec: identity/demo-data
related_specs: ["audit/audit-trail"]
requirement: "Auditoría de la carga y de la limpieza"
scenario: "La evidencia sobrevive a la purga"
requirement_status: confirmed
fr: ["FR-IDENTITY-015","FR-AUDIT-001","FR-AUDIT-005"]
nfr: []
invariants: ["INV-029"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-data.int.test.ts","packages/contexts/identity/src/application/demo-data.service.test.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["demo-data","audit"]
error_code: null
preconditions:
  - "owner@demo.pfos.test es OWNER de \"W1 Personal Demo\""
input: {"sequence":["cargar demo","limpiar demo","purgar"]}
steps:
  - "Cargar, limpiar y purgar la demo"
  - "Consultar el historial de auditoría de W1"
expected_result:
  - "W1 contiene identity.demo.load_requested, identity.demo.loaded, identity.demo.cleanup_requested e identity.demo.purged en orden, con actor, instante e id del workspace demo"
  - "Ningún registro de auditoría contiene datos financieros del demo"
created: 2026-10-03
updated: 2026-10-04
---

# TC-IDENTITY-DEMO-013 — La auditoría de carga y limpieza queda en el workspace de origen y sobrevive a la purga

## Intención

La purga borra la auditoría interna del demo; la evidencia de quién cargó y limpió debe vivir en un workspace que no se purga.

## Escenario

```gherkin
Dado que cargué, limpié y purgué la demo desde "W1 Personal Demo"
Cuando consulto la auditoría de W1
Entonces veo la carga y la limpieza con actor, instante e id del workspace demo
```

## Notas

