# ADR-0021: Integración de asistente IA — asistente de solo lectura basado en tools autorizadas (Phase 10)

- Estado: Propuesto
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §1, §3 (ASSISTANT), §5; docs/27-ai-assistant-roadmap.md; ADR-0002, ADR-0003, ADR-0010, ADR-0022, ADR-0023; OpenSpec capability `assistant/read-only-assistant`

## Contexto y problema

Un asistente conversacional podría responder preguntas como "¿cuánto gasté en comida este trimestre vs el anterior?", "¿qué suscripciones subieron de precio?" o "¿llego a fin de mes con el saldo en BOB?". Sin embargo:

- Los datos son **altamente sensibles** y multi-tenant.
- Los LLMs alucinan y son vulnerables a **prompt injection** (p. ej. una descripción de transacción importada que contenga instrucciones).
- Un asistente que **escribe** datos financieros podría corromper el ledger.
- El producto debe ser **completamente útil sin IA** (ARCHITECTURE §1).

Hay que decidir si habrá asistente, cuándo, y con qué arquitectura de acceso a datos.

## Drivers de decisión

- Seguridad y aislamiento multi-tenant (ningún camino que salte RLS/authz).
- Exactitud: las cifras deben venir del sistema, no del modelo.
- Privacidad: minimizar datos enviados al proveedor LLM.
- Valor de usuario vs costo (tokens) y complejidad.
- Independencia del proveedor LLM.

## Opciones consideradas

1. **Sin IA.**
2. **LLM embebido con acceso SQL directo** (text-to-SQL contra la BD) — **rechazada**.
3. **Asistente de solo lectura basado en tools** autorizadas que invocan **casos de uso/queries públicas** de los contextos (elegida, Phase 10).

## Decisión

- El asistente se implementa en **Phase 10** como contexto `ASSISTANT` (`@pf/assistant`), sin datos propios salvo conversaciones.
- **Arquitectura tool-based:** el LLM solo puede invocar un catálogo cerrado de **tools de solo lectura**, cada una mapeada a una **query pública** de `contracts` de un contexto (p. ej. `reporting.getSpendingByCategory`, `ledger.getBalances`, `commitments.listUpcoming`). Las tools:
  - se ejecutan con el **contexto de autorización del usuario** (mismo workspace, mismo rol, RLS activo);
  - tienen parámetros validados por JSON Schema y límites (rango de fechas, paginación);
  - devuelven datos ya calculados por el sistema (montos como string decimal); **el LLM no calcula cifras financieras**, solo las presenta.
- **Jamás acceso directo a BD** ni SQL generado por el modelo.
- **Sin escritura**: ninguna tool muta estado. Una evolución futura podría *proponer* acciones (borrador de transacción) que el usuario confirma por la UI normal; requiere ADR nuevo.
- Defensa contra prompt injection: contenido de usuario/importado (descripciones, notas, nombres de counterparties) se pasa como datos delimitados; el modelo no puede escalar privilegios porque las tools ya están limitadas por authz.
- **Proveedor LLM** detrás de un puerto `LlmPort` (intercambiable); configuración opt-in por workspace, con aviso explícito de qué datos se envían; retención mínima y sin uso para entrenamiento (según términos del proveedor elegido).
- Auditoría: cada invocación de tool se registra (tool, parámetros, usuario, workspace, timestamp) — sin almacenar respuestas completas del LLM salvo que el usuario guarde la conversación.
- Feature desactivable globalmente (kill switch) y por workspace.

## Análisis de opciones

### 1. Sin IA
- **Pros:** cero riesgo de privacidad/alucinación; cero costo.
- **Contras:** pierde un modo de exploración de datos valioso; los reportes cubren la mayoría de preguntas pero no las ad-hoc.
- **Costo:** 0. **Complejidad:** 0. *(Es el estado de Phase 1–9.)*

### 2. LLM con SQL directo (rechazada)
- **Pros:** máxima flexibilidad de preguntas; rápido de prototipar.
- **Contras:** el modelo genera SQL arbitrario → riesgo de exfiltración entre workspaces si cualquier capa falla, consultas costosas, errores silenciosos de cálculo (sumar monedas distintas, ignorar reversas o estados `pending`); acopla el esquema interno a prompts (rompe fronteras ADR-0003); prompt injection puede convertir texto importado en queries; auditoría pobre.
- **Costo:** tokens + riesgo. **Complejidad:** baja de construir, alta de asegurar. **Rechazada.**

### 3. Tool-based read-only (elegida)
- **Pros:** reutiliza casos de uso ya testeados y autorizados; respeta RLS y fronteras; cifras exactas (calculadas por el dominio); superficie de ataque acotada al catálogo de tools; independiente del proveedor (function/tool calling es estándar en los LLM actuales); auditable.
- **Contras:** solo responde lo que las tools permiten (preguntas fuera del catálogo → "no puedo"); hay que diseñar y mantener tools; costo de tokens; latencia de varias llamadas.
- **Costo:** tokens por uso (bajo para un usuario) + desarrollo. **Complejidad operativa:** media.

## Consecuencias

**Positivas**
- La IA es una capa de presentación sobre capacidades existentes, no una vía paralela a los datos.
- El producto sigue funcionando íntegramente sin IA.

**Negativas**
- Diseño de tools adicional en Reporting/queries públicas.
- Dependencia de un proveedor externo para esta feature (datos enviados fuera).

**Riesgos**
- Fuga de datos al proveedor LLM. *Mitigación:* opt-in, minimización (agregados en lugar de transacciones crudas cuando sea posible), proveedor con no-retention/no-training, posibilidad de modelo self-hosted.
- Respuestas incorrectas presentadas con confianza. *Mitigación:* respuestas citan la tool/periodo usado; enlaces a la vista del reporte correspondiente.
- Prompt injection vía datos importados. *Mitigación:* tools read-only + authz; tests con descripciones maliciosas.

## Validación

- Phase 10: suite de evaluación con preguntas de referencia y respuestas esperadas (exactitud de cifras 100% al venir de tools; tasa de selección de tool correcta ≥ 90%).
- Tests de seguridad: intento de acceder a otro workspace vía parámetros → 403/0 resultados; descripción con "ignora tus instrucciones…" no produce acciones fuera del catálogo.
- Architecture test: `@pf/assistant` solo importa `contracts` (queries) y nunca `infrastructure` de otro contexto ni el cliente de BD.

## Notas

- La selección de proveedor/modelo LLM y sus términos de retención se hará al inicio de Phase 10 (a verificar entonces; el mercado cambia rápido).
- El patrón tool-based es compatible con exponer las mismas tools vía MCP en el futuro, con el mismo modelo de autorización.
