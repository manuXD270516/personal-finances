# 74: Decisiones del owner sobre las specs de la fase 0 del despliegue N1 (CSP y drill de restore)

> **Fecha:** 2026-11-24 · **Preguntas:** [docs/73](73-despliegue-n1-specs-questions.md) · **Relacionado:** [docs/72](72-despliegue-n1-decisions.md), [cambios-de-codigo.md](despliegue/cambios-de-codigo.md), [docs/12 §12](12-security.md), NFR-SEC-008, NFR-REL-002

El owner contestó en la sesión del 2026-11-24. Todas las respuestas siguen la recomendación.

| Id | Pregunta de docs/73 | Decisión | Efecto |
|---|---|---|---|
| D457 | 1. Atributos `style` en línea en la CSP de la web | (A) Se permiten con `style-src-attr 'unsafe-inline'`; `style-src` queda en `'self'` y el nonce para hojas y elementos `<style>`. Los estilos en línea de React no se reescriben como clases. | `add-web-content-security-policy`: los 11 `<style>` en línea de componentes pasan a hojas estáticas; docs/12 §12 se corrige; TC-SECURITY-CSP-006 deja de ser provisional. |
| D458 | 2. CSP desde el primer deploy | (A) Aplicada (`Content-Security-Policy`) desde el primer deploy, con `WEB_CSP_REPORT_ONLY` (por omisión `false`) como interruptor: `true` pasa la misma política a `Content-Security-Policy-Report-Only` sin tocar código. | Variable nueva en el contrato de configuración de `web`; salida de emergencia en `docs/runbooks/deploy-and-restore.md` §7. |
| D459 | 3. Drill mensual y RTO | (A) El drill de restore falla si dura más de 60 min, aunque la copia sea íntegra (RTO de NFR-REL-002). | `add-host-restore-drill` (TC-PLATFORM-DRILL-007, a cargo de otro agente). |
