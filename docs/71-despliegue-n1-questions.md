# 71: Preguntas abiertas del despliegue N1 (fase 1 del runbook)

> **Respuestas:** pendientes; van en el `…-decisions.md` siguiente y en [docs/38](38-estado-y-pendientes.md) · **Fecha:** 2026-11-24 · **Origen:** estrategia de despliegue ([DECISION-DESPLIEGUE.md](despliegue/DECISION-DESPLIEGUE.md)) y ratificación del 2026-11-24 · **Runbook:** [fase 1](despliegue/RUNBOOK-DESPLIEGUE.md#fase-1-decisiones-del-owner-vos) · **Guía:** [GUIA-PRUEBAS-FUNCIONALES.md](despliegue/GUIA-PRUEBAS-FUNCIONALES.md)

El panel ratificó Lightsail N1 (3,62 contra 2,45 de Oracle A1, 3 de 3) y separó por causa la salida del PoC: memoria → N2 o plan B; CPU → solo plan B (C14). Antes de abrir cuentas hacen falta estas decisiones. Las preguntas 1 a 4 **bloquean** el orden del runbook; la 5 bloquea solo la forma de la fase 7, y la 6 no bloquea.

El umbral del import de 5 000 filas en el host ya no es una pregunta: lo fija la regla de corte de CPU de C14 (persistencia > 20 s con créditos o > 60 s sin créditos → plan B).

## Pregunta 1: ¿qué dominio se usa?

Caddy necesita tres hostnames (`app`, `auth` y `files`, D316) con registros A en Cloudflare en modo solo DNS. ADR-0027 supone un dominio propio; no está verificado.

- **Opción A (recomendada):** un dominio propio dedicado a PFOS, con los tres subdominios. Aísla las cookies y el HSTS de cualquier otro sitio.
- **Opción B:** subdominios de un dominio que ya tengas (por ejemplo `app.pfos.<dominio>`). Más barato, pero el HSTS y las cookies del dominio padre pasan a importar.

**Bloquea:** fases 2 y 3 (DNS y `PF_DOMAIN_*` en `/etc/pfos/pfos.env`).

## Pregunta 2: ¿cuál es la salida si el PoC falla, y se prepara el plan B antes del PoC?

N2 (`medium_3_0`, 4 GB) tiene las mismas 2 vCPU con la misma base del 20 %: solo resuelve la memoria. Un corte por CPU lleva al plan B (Oracle A1), que hoy no está listo: le faltan C12a (multi-arch en `main.yml` y `pr.yml` con verify-by-digest), C12b (digests de índice de terceros, `RCLONE_IMAGE` y pgBackRest arm64) y C12c (módulo `oci-host` y cloud-init).

- **Salida por memoria:**
  - **Opción A:** ampliar el presupuesto a ≈ USD 27–30 por mes y pasar a N2. Reemplaza la VM y se restaura según §5.2.
  - **Opción B (recomendada si el tope de USD 20 es firme):** plan B.
- **Salida por CPU:** solo el plan B; no hay opción con N2.
- **Preparación:**
  - **Opción A (recomendada):** hacer C12a y C12b **antes** del PoC, en una rama, y dejar C12c para cuando se active el plan B. La salida barata queda lista sin esperar a que el host falle.
  - **Opción B:** prepararlo todo recién si el PoC corta, aceptando días sin despliegue.

**Bloquea:** el orden de la fase 0 (si C12a y C12b entran) y la fase 7.

## Pregunta 3: ¿cómo se protege la retención de los respaldos mensuales (C3)?

El Object Lock del bucket es de 21 días y la clave del host tiene `deleteFiles`: pasados 21 días, un host comprometido puede borrar los 12 mensuales.

- **Opción A (recomendada):** un segundo bucket para repo2 con Object Lock governance de ≥ 395 días (13 meses). Las versiones bloqueadas no se destruyen hasta que vence el lock.
- **Opción B:** quitar `deleteFiles` de la clave del host para el prefijo mensual. Exige probar qué hace `expire` sin permiso de borrado.

**Bloquea:** el primer `tofu apply` (fase 3). Object Lock no se puede desactivar en un bucket que lo tiene.

## Pregunta 4: ¿qué formato tiene el drill de restore programado (C5)?

ADR-0027 promete un drill mensual automatizado que falla si no restaura, y no existe.

- **Opción A (recomendada):** drill local mensual en el host con la clave de solo lectura (`pfos-restore-drill.timer`), que avisa por el heartbeat, más el drill fuera del host (§6, VM efímera) cada trimestre.
- **Opción B:** solo el drill fuera del host, trimestral. No cubre el mes a mes y depende de que alguien lo haga.

**Bloquea:** la fase 0 (C5) y los datos reales (fase 8).

## Pregunta 5: ¿se habilitan los datos demo durante el PoC?

La fase 7 y la guía usan el workspace demo (21 meses de historia ficticia) para reportes, deudas, metas y suscripciones. `production` trae `DEMO_DATA_ENABLED=false` y la comprobación 8 de la fase 6 lo exige así.

- **Opción A (recomendada):** habilitarlo solo durante el PoC: `true` y redeploy en la fase 7, `false` en la limpieza, y la comprobación 8 repetida en la fase 8.
- **Opción B:** no usar la demo. Los casos que la usan dejan de ser bloqueantes y los 15 reportes se abren con los datos de «GF Pruebas» (guía, §0.4).
- **Opción C:** generar la carga con la suite E2E apuntada a `$BASE`. Requiere adaptar la suite y no reemplaza la demo en la guía.

**Bloquea:** solo la forma de la fase 7 y de la guía, no el orden.

## Pregunta 6: ¿se prueba en la guía la lectura de un PDF que cuadra?

El repositorio no versiona PDF; los E2E los generan en memoria con `paint-statement.ts`. Sin un PDF en disco, la guía solo prueba los rechazos (GF-IMP-12 y 13).

- **Opción A (recomendada):** dejar la lectura exitosa para tus extractos reales (tarea 9.1 del change 57, `add-pdf-statement-parser`), fuera del repositorio.
- **Opción B:** pedir un comando que escriba en disco el PDF sintético de Ganadero para probarlo antes de los datos reales.

**No bloquea.**
