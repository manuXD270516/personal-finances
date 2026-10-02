---
id: TC-AUDIT-REDACTION-001
title: "La auditoría enmascara identificadores de cuenta y nunca guarda tokens, pero conserva los montos"
spec: audit/audit-trail
related_specs: ["accounts/account-management"]
requirement: "Datos sensibles excluidos de la auditoría"
scenario: "Identificador de cuenta enmascarado"
requirement_status: confirmed
fr: [FR-AUDIT-002]
nfr: [NFR-SEC-015]
invariants: []
priority: critical
type: security
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["audit", "privacy", "redaction"]
error_code: null
preconditions:
  - "Bank A en W1"
  - "Solicitud con cookie de sesión y Authorization con valores canario CANARY-TOKEN-123"
  - "Clave HMAC de IP de prueba"
input:
  update: "accountNumberLast4 de Bank A = \"6789\" (la UI recibió \"DEMO-000123456789\")"
  open: "Abrir USDT Wallet con saldo inicial 100.000000 USDT"
steps:
  - "Ejecutar la actualización y la apertura"
  - "Buscar en todas las filas de auditoría los valores canario, el identificador completo y la IP en claro"
expected_result:
  - "La auditoría muestra el identificador solo como \"6789\""
  - "Ninguna fila contiene \"DEMO-000123456789\", CANARY-TOKEN-123, la cookie ni la IP en claro (solo su HMAC)"
  - "La apertura registra el monto {amount: \"100.000000\", currency: \"USDT\"}"
  - "Un campo no incluido en la allow-list del agregado no aparece en changes"
created: 2026-10-02
updated: 2026-10-02
---

# TC-AUDIT-REDACTION-001 — La auditoría enmascara identificadores de cuenta y nunca guarda tokens, pero conserva los montos

## Intención

La auditoría es para montos y responsables, no para secretos (docs/12 §13). Un test "canario" detecta fugas por campos nuevos.

## Escenario

```gherkin
Dado una solicitud con tokens canario
Cuando el usuario cambia el identificador de "Bank A" y abre "USDT Wallet" con 100.000000 USDT
Entonces la auditoría muestra "6789" y 100.000000 USDT
  Y no contiene ningún valor canario ni el identificador completo
```
