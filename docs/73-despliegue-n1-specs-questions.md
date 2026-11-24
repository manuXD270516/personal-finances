# 73: Preguntas de las specs de la fase 0 del despliegue N1 (CSP y operación del host)

> **Respuestas:** pendientes; van en el `…-decisions.md` siguiente y en [docs/38](38-estado-y-pendientes.md) · **Fecha:** 2026-11-24 · **Origen:** changes [`add-web-content-security-policy`](../openspec/changes/add-web-content-security-policy/proposal.md) (C13) y [`add-host-restore-drill`](../openspec/changes/add-host-restore-drill/proposal.md) (C5, C6 y C10) de [cambios-de-codigo.md](despliegue/cambios-de-codigo.md) · **Relacionado:** [docs/72](72-despliegue-n1-decisions.md) (D456), [docs/12 §12](12-security.md), NFR-SEC-008, NFR-REL-002

Ninguna bloquea el orden del runbook. La pregunta 1 bloquea la implementación de C13 solo si se elige la opción B; las 2 y 3 se implementan con la recomendación si no hay respuesta antes del grupo de tareas que las usa.

## Pregunta 1: ¿se permiten los atributos `style` en línea en la CSP de la web?

React escribe cada prop `style={…}` como un atributo `style="…"` en el HTML que renderiza el servidor, y la web tiene unas 3 400 en 172 archivos (anchos de barras, colores por serie, márgenes). Una CSP con `style-src 'self' 'nonce-…'`, como la de docs/12 §12, bloquea esos atributos: los nonces no aplican a atributos, y la hidratación no los vuelve a aplicar, así que las pantallas quedan sin estilos. NFR-SEC-008 prohíbe `unsafe-inline` solo en scripts.

- **Opción A (recomendada):** `style-src-attr 'unsafe-inline'` y `style-src 'self' 'nonce-…'` para hojas y elementos `<style>`. Los 11 `<style>` en línea de componentes pasan a hojas estáticas. El riesgo que queda (inyectar estilos por atributo) exige una inyección de HTML que React ya escapa, y la web no usa `dangerouslySetInnerHTML`. Se corrige docs/12 §12.
- **Opción B:** reescribir los estilos en línea como clases y dejar `style-src-attr 'none'`. Los valores calculados (anchos, colores) obligan a reescribir también los gráficos en SVG con atributos de presentación. Son semanas de trabajo y tocan casi toda la UI, para un riesgo bajo.

**Bloquea:** los grupos 3 a 5 de `add-web-content-security-policy` solo si se elige B.

## Pregunta 2: ¿la CSP se aplica desde el primer deploy o empieza como `Report-Only`?

docs/12 §12 pedía `Report-Only` en staging antes de aplicarla. N1 no tiene staging ni un colector de reportes. La suite E2E (≈ 50 specs con las imágenes de producción) corre con la CSP aplicada, y una spec nueva recorre todas las pantallas y falla ante cualquier violación.

- **Opción A (recomendada):** aplicada desde el primer deploy, con una variable `WEB_CSP_REPORT_ONLY` (por omisión `false`) que pasa la cabecera a `Report-Only` sin tocar código: si una pantalla se rompe en producción, se cambia en `/etc/pfos/pfos.env` y se redespliega el mismo SHA.
- **Opción B:** la fase 7 (PoC) en `Report-Only`, mirando la consola del navegador, y aplicada antes de los datos reales (fase 8). Suma un paso manual y la comprobación del PoC no ve las violaciones salvo que alguien abra la consola.
- **Opción C:** aplicada y sin interruptor. Ante un problema, la salida es un rollback.

**No bloquea.**

## Pregunta 3: ¿el drill mensual falla cuando tarda más de 60 minutos?

NFR-REL-002 fija un RTO observado en el drill menor a 1 hora. El drill del host corre con techo de 256 MiB y 0,5 CPU para no tirar el stack, así que puede ser más lento que un restore real con todo el host disponible. Con una base de menos de 2 GB debería tardar minutos.

- **Opción A (recomendada):** falla el heartbeat si la duración total pasa los 60 min, aunque la copia sea íntegra. Un drill que no cumple el objetivo es una señal que hay que mirar, y con una base chica no debería dar falsos positivos.
- **Opción B:** solo registrar la duración en `drills.log` y en el cuerpo del heartbeat, sin fallar. El RTO se evalúa en el drill trimestral fuera del host, con la VM completa.

**No bloquea:** se implementa con A si no hay respuesta.
