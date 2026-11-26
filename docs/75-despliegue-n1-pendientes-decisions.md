# 75: Decisiones del owner sobre las preguntas pendientes del despliegue N1

> **Fecha:** 2026-11-25 · **Preguntas:** [docs/71](71-despliegue-n1-questions.md) (5 y 6) y los pendientes de [docs/38 §2](38-estado-y-pendientes.md) · **Relacionado:** [docs/72](72-despliegue-n1-decisions.md), [docs/74](74-despliegue-n1-specs-decisions.md), [RUNBOOK-DESPLIEGUE.md](despliegue/RUNBOOK-DESPLIEGUE.md), [GUIA-PRUEBAS-FUNCIONALES.md](despliegue/GUIA-PRUEBAS-FUNCIONALES.md), [docs/23 §16](23-ci-cd.md)

El owner contestó el 2026-11-25. Las cuatro primeras siguen la recomendación; D462 es un «no por ahora» con la pregunta reabierta antes de la fase 8.

| Id | Pregunta | Decisión | Efecto |
|---|---|---|---|
| D460 | 5 de docs/71: datos demo durante el PoC | (A) Solo durante el PoC: `DEMO_DATA_ENABLED=true` y redeploy en la fase 7, `false` en la limpieza, y la comprobación 8 de la fase 6 repetida en la fase 8. | Runbook (fases 1, 6, 7 y 8) y guía (§0.3 y §0.4): los casos con demo **siguen siendo bloqueantes**; §0.4 queda como contingencia si la carga falla. |
| D461 | 6 de docs/71: lectura de un PDF que cuadra | (B) Un comando que escriba en disco el PDF sintético de Ganadero para probar en la guía la lectura exitosa antes de los datos reales. | `pnpm imports:pdf:sample <ruta>` (script `packages/contexts/imports/scripts/pdf-sample.ts`, TC-IMPORTS-PDF-050); caso nuevo GF-IMP-15 (bloqueante) en la guía. Los extractos reales siguen siendo del owner (tarea 9.1 del change 57). Ningún PDF se versiona. |
| D462 | Tercer bucket que proteja `documents/` (hoy con Object Lock de 21 días) | **No por ahora.** Se vuelve a preguntar al owner **antes de la migración de datos reales** (fase 8). | Riesgo residual anotado: pasados 21 días, un host comprometido con la clave del host podría destruir versiones de `documents/`. Pendiente en docs/38 §2 y en el runbook (fase 1). |
| D463 | Checks obligatorios nuevos en `main` | `image (pfos-keycloak)` pasa a **check obligatorio** (ya aplicado en la protección de rama por la sesión principal: ahora son **19**). Las filas `image (…, arm64)` **no** se vuelven obligatorias: ya gatean de hecho vía `needs` de `stack-smoke` y `e2e`. | `CLAUDE.md` y [docs/23 §16](23-ci-cd.md) (nota as-built del 2026-11-25); `strict` y `enforce_admins` sin cambios. |
| D464 | Tarea 6.3 del change 68 (`add-web-content-security-policy`, archivado) | Se acepta con la evidencia registrada: una corrida E2E local limpia (115 verdes y 1 omitido), el check `e2e` de CI de #270 en verde, y un fallo ajeno en la segunda corrida local (`TC-FX-PROVIDER-010`, por estado acumulado de un stack reutilizado). | Sin cambios de código; deja de ser pendiente del owner. |

## Qué cambia en la práctica

- **Fase 7:** la carga incluye el workspace demo y la lectura del PDF sintético (`pnpm imports:pdf:sample`, GF-IMP-15). Al limpiar, `DEMO_DATA_ENABLED` vuelve a `false`.
- **Fase 8:** antes de cargar datos reales, repetir la comprobación 8 de la fase 6 y **volver a preguntar** por el tercer bucket de `documents/` (D462).
- **PR:** el check `image (pfos-keycloak)` es obligatorio; una PR que rompa esa imagen ya no se fusiona.
