# 72: Decisiones del owner sobre el despliegue N1 y el fix de tendencias

> **Fecha:** 2026-11-24 · **Preguntas:** [docs/71](71-despliegue-n1-questions.md) · **Relacionado:** [DECISION-DESPLIEGUE.md](despliegue/DECISION-DESPLIEGUE.md), [RUNBOOK-DESPLIEGUE.md](despliegue/RUNBOOK-DESPLIEGUE.md), [cambios-de-codigo.md](despliegue/cambios-de-codigo.md), [docs/70](70-trends-report-perf-decisions.md)

El owner contestó en la sesión del 2026-11-24. Todas las respuestas siguen la recomendación.

## Fix de tendencias (`fix-trends-report-perf`, PR #258)

| Id | Tema | Decisión |
|---|---|---|
| D450 | Fases sobre la estimación del diseño | Se aceptan `resolveRates` en 22 ms (objetivo ≤ 20) y `trendMatrix` en 53 ms (objetivo ≤ 40): el criterio principal (p95 ≤ 50 % del anterior, p50 < 230 ms) se cumple y el piso son las valoraciones de `ReportConversionPolicy.value`. No se pide otra optimización. |
| D451 | Cambio en `shared-kernel` fuera del diseño | Se acepta el formateador por zona en memoria de `endOfDayInstant` (`packages/shared-kernel/src/time/end-of-day.ts`, tope de 64 zonas). No cambia el resultado y conserva el error `INVALID_TIMEZONE`. |

## Despliegue N1 (fase 1 del runbook)

| Id | Pregunta de docs/71 | Decisión | Desbloquea |
|---|---|---|---|
| D452 | 1. Dominio | (A) Un dominio propio dedicado a PFOS, con DNS en Cloudflare, para los tres hostnames (app, auth y files). El owner lo registra. | Fases 2 y 3 |
| D453 | 2. Salida si el PoC corta por memoria | (B) Plan B Oracle A1: se mantiene el tope de USD 20 y no se amplía a N2. Si corta por CPU, la salida también es el plan B (N2 no suma CPU sostenida). | Fase 7 |
| D454 | 2. Preparación del plan B | (A) C12a y C12b (imágenes multi-arch en CI y digests de índice de terceros) se hacen **antes** del PoC, cada uno con su rama, su PR y, si corresponde, su change. C12c (`oci-host`, cloud-init de OCI y addendum al ADR) queda para cuando el PoC corte. Un check obligatorio nuevo en `pr.yml` sigue requiriendo confirmación del owner. | Fase 0 |
| D455 | 3. Retención de los mensuales (C3) | (A) Segundo bucket de B2 con Object Lock de ≥ 395 días para los mensuales, imborrable con la clave del host. | Primer `tofu apply` |
| D456 | 4. Drill de restore (C5) | (A) Drill local mensual con timer y aviso por heartbeat si falla, más un drill fuera del host cada trimestre (§6 de deploy-and-restore). | Fase 0 y datos reales |

Siguen abiertas las preguntas 5 (datos demo durante el PoC) y 6 (PDF que cuadra en la guía). La 5 cambia la forma de la fase 7 y se decide antes de esa fase; la 6 no bloquea.
