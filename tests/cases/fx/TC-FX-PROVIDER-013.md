---
id: TC-FX-PROVIDER-013
title: "Las solicitudes a providers son anónimas e idénticas para cualquier workspace"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Las consultas a providers no envían datos del usuario"
scenario: "Solicitud al provider principal"
requirement_status: confirmed
fr: ["FR-FX-015"]
nfr: ["NFR-COMP-001"]
invariants: ["INV-025"]
priority: critical
type: security
level: security
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/infrastructure/providers/provider-http-client.test.ts
  - packages/contexts/fx/src/infrastructure/providers/providers.architecture.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
  - packages/contexts/fx/test/integration/providers.int.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","provider","privacy","security"]
error_code: null
preconditions:
  - "Servidor HTTP local que registra método, URL, cabeceras y cuerpo de cada solicitud"
  - "Dos workspaces A y B con saldos, monedas y miembros distintos"
input: {"cycle": "2026-10-02T09:00:00Z"}
steps:
  - "Ejecutar un ciclo de polling"
  - "Inspeccionar las solicitudes registradas"
expected_result:
  - "Exactamente una solicitud GET a /api/v1/rate (paralelo.bo) y una a /v1/dolares (bo.dolarapi.com) para ambos workspaces"
  - "Sin query string, sin cuerpo, sin Cookie ni Authorization"
  - "Cabeceras limitadas a Accept y User-Agent genérico \"PFOS-fx/<versión>\""
  - "Ningún byte de la solicitud contiene ids de workspace o usuario, montos, saldos, cuentas, monedas habilitadas ni zona horaria"
  - "Ambos workspaces reciben las tasas en filas propias (RLS)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-013 — Las solicitudes a providers son anónimas e idénticas para cualquier workspace

## Intención

NFR-COMP-001: el inventario de flujos de datos a terceros debe seguir vacío aunque haya integraciones de tasas.

## Escenario

```gherkin
Dados dos workspaces con datos distintos
Cuando el job consulta paralelo.bo
Entonces se envía una sola solicitud GET sin parámetros ni credenciales
  Y no contiene ningún dato de usuario ni de workspace
```

## Notas

- Cubre también el scenario "Dos workspaces". Complementa el test de arquitectura de la tarea 4.5 (el cliente HTTP no recibe contexto de workspace).
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
