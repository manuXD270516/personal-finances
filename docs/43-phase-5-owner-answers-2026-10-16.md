# 43 — Respuestas del owner de Phase 5 (2026-10-15 y 2026-10-16) y decisiones D256–D282

> **Estado:** Registrado (respuestas del owner a todas las preguntas abiertas de docs/42 y de los changes 41 y 45; sin preguntas nuevas) · **Fecha:** 2026-10-16 · **Relacionado:** [42-phase-5-owner-answers-and-decisions.md](42-phase-5-owner-answers-and-decisions.md) (D251–D255), [41-phase-5-consolidation-decisions.md](41-phase-5-consolidation-decisions.md), [ADR-0029](adr/0029-fuentes-de-precios-cripto.md) (aceptado con condiciones), changes `add-crypto-rate-providers` (38), `add-exchange-house-rate-providers` (41) y `add-dependency-updates` (45)

La numeración continúa la de docs/42 (último id usado: D255). Este documento registra cada respuesta **tal cual** y su consecuencia en una línea; el detalle lo desarrolla cada change en su design, tasks, specs y TC.

## Mensajes del owner (tal cual)

- **2026-10-15:** "Doy aprobación para el acceso de términos y condiciones".
- **2026-10-16:** "Preguntas abiertas: Toma todas las recomendaciones · Cripto (ADR-0029): Toma todas las recomendaciones · Change 41: Toma las recomendaciones propuestas, adjunto 3 extractos bancarios".
- **2026-10-16:** informó que **instaló la app de Mend Renovate en GitHub**.

"Toma todas las recomendaciones" se lee como la adopción de la opción marcada como recomendación en cada pregunta abierta de los tres frentes. Las filas siguientes citan la respuesta que aplica a cada pregunta.

## Respuestas del owner

### Fuentes de precios cripto (docs/42 §Preguntas nuevas, ADR-0029)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D256 | docs/42, pregunta 1: principal y respaldo cripto | "Cripto (ADR-0029): Toma todas las recomendaciones" → (a) | ADR-0029 pasa a **Aceptado** (2026-10-16): principal `CRYPTO_BINANCE` (`data-api.binance.vision`) y respaldo `CRYPTO_BYBIT`; Bitget queda como candidata siguiente, sin adapter. |
| D257 | docs/42, pregunta 2: uso personal y no redistribución | Ídem → (a) | PFOS sigue siendo de uso personal; antes de ofrecerlo a terceros se pide consentimiento escrito a cada exchange (condición C1 de ADR-0029). |
| D258 | docs/42, pregunta 3: lectura directa de términos y fixtures | Ídem → (a) | La sesión de implementación, desde una red con acceso (máquina del owner o VPS N1), lee los términos vigentes, graba los fixtures y lo registra en ADR-0029 antes de marcar `VERIFIED` (tarea 1.5 del change 38, sigue abierta). |
| D259 | docs/42, pregunta 4: smoke en vivo desde GitHub Actions | Ídem → (a) | El smoke nightly cripto clasifica 451/403 de origen geográfico como "no concluyente" (no abre el aviso de revisión del adapter); la salud real se vigila con el estado de providers del VPS N1. |
| D260 | Acceso a términos y condiciones de las fuentes (C2 de ADR-0029; tarea 1.1 del change 41) | "Doy aprobación para el acceso de términos y condiciones" (2026-10-15) | Queda autorizada la lectura directa de los términos de los exchanges, de ASFI y del BCB. **Salvedad:** la red del entorno de las sesiones en la nube sigue sin permitir esos dominios y solo el owner puede cambiarla; hasta entonces la lectura se hace desde su máquina o el VPS N1, y ninguna fuente pasa a `VERIFIED`. |

### Renovate (change 45 `add-dependency-updates`)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D261 | D254 (el owner instalará Renovate) | El owner informó el 2026-10-16 que **instaló la app de Mend Renovate en GitHub**. | D254 cumplido en la instalación. La tarea 3.1 del change 45 pasa a verificar que la app abrió su PR de configuración (onboarding) y cerrarla o reemplazarla con `renovate.json5`; esa verificación no está hecha. |
| D262 | Change 45, pregunta 2: ventana y límite de PR | "Preguntas abiertas: Toma todas las recomendaciones" → (a) | Lunes antes de las 06:00 `America/La_Paz`, con 5 PR abiertas como máximo. |
| D263 | Change 45, pregunta 3 [B]: gestores y archivos | Ídem → (a) | Workspace pnpm, `.nvmrc` y `engines`, acciones por SHA, Dockerfiles, compose y gestor regex para las imágenes de Testcontainers (PostgreSQL también por digest); los binarios de Trivy y gitleaks con SHA-256 quedan fuera (revisión manual trimestral); `spikes/` fuera. Desbloquea el grupo 2. |
| D264 | Change 45, pregunta 4 [B]: qué se fusiona solo | Ídem → (a) | Automerge nativo (con los 17 checks) solo para parches de dependencias de desarrollo y digests y parches de acciones de CI e imágenes de desarrollo; el resto espera revisión del owner. Desbloquea el grupo 2. |
| D265 | Change 45, pregunta 5: vulnerabilidades | Ídem → (a) | PR de seguridad fuera de la ventana semanal con etiqueta `security`, respetando la antigüedad mínima de pnpm y sin automerge de majors; el owner activa Dependabot alerts (solo alertas) en la configuración del repositorio. |
| D266 | Change 45, pregunta 6 [B]: antigüedad mínima | Ídem → (a) | 3 días, nunca menor que la de pnpm. Desbloquea el grupo 2. |
| D267 | Change 45, pregunta 7: quién revisa las PR del bot | Ídem → (a) | El owner revisa majors y lo que no se fusiona solo; una sesión `implementador` puede diagnosticar y corregir una PR del bot en rojo en su misma rama, sin fusionar majors ni activar automerge en ellas. |
| D268 | Change 45, pregunta 8: idioma del bot | Ídem → (a) | Plantillas de commit y PR en español donde Renovate lo permite; las notas de versión de terceros quedan en su idioma. |
| D269 | Change 45, pregunta 9: NFR-PERF-002 bloqueante | Ídem → (a) | Bloqueante en el nightly desde la primera corrida; si no cumple, change de corrección aparte. |
| D270 | Change 45, pregunta 10: aviso por fallo del nightly | Ídem → (a) | Al fallar el job `perf`, se abre o comenta el issue "nightly perf: umbral superado" con el resumen, con `issues: write` declarado solo en ese job (no a nivel de workflow; `fx-smoke-live` conserva el suyo); nuevo scenario en `platform/delivery-pipeline` y TC-PLATFORM-PIPELINE-009. No toca la protección de rama ni los checks requeridos. |
| D271 | Change 45, pregunta 11: snapshot del Large Seed | Ídem → (a) | Se sigue generando en cada corrida; el snapshot se difiere al Hito H. |

### Bancos y billeteras (change 41 `add-exchange-house-rate-providers`)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D272 | Change 41, pregunta 1: criterio de "soporte completo" | "Change 41: Toma las recomendaciones propuestas" → (a) | Censo al 100 % y ninguna entidad pendiente; `NOT_ELIGIBLE` cuenta como resuelta y se informa aparte con su razón. |
| D273 | Change 41, pregunta 2 [B]: nombres reales en el repositorio | Ídem → (a) | Se permiten nombres reales de entidades públicas de registro (nombre, sigla, categoría, sitio web), sin logos ni marcas, con fuente y fecha de corte; los tests siguen con datos ficticios. La tarea 4.2 ya no depende de esta pregunta, pero sigue requiriendo la verificación de la tarea 1.1. |
| D274 | Change 41, pregunta 3: empresas de tecnología financiera | Ídem → (a) | Se incluyen cuando ASFI publique su lista con licencia; la categoría queda vacía hasta entonces. |
| D275 | Change 41, pregunta 4: tipo de cooperativas, IFD y EFV | Ídem → (a) | `InstitutionKind` = `BANK`, con la categoría regulatoria visible aparte; el enum no se amplía. |
| D276 | Change 41, pregunta 5: fuente `OFFICIAL` con el régimen flexible | Ídem → (a) | En la tarea 1.1 se verifica si la casa `oficial` de bo.dolarapi.com sigue al TCO diario; si el BCB califica, pasa a principal de `OFFICIAL` con dolarapi de respaldo, en un change o corrección aparte (no en el 41). |
| D277 | Change 41, pregunta 6 [B]: adelantar la importación por institución | Ídem → (a) | Solo fichas de formato ahora (tarea 8.3); perfiles en Phase 6 y parser de PDF en un change propio cuando haya fichas de al menos 3 entidades. |
| D278 | Change 41, pregunta 7: qué entidades registrar por workspace | Ídem → (a) | Todas las que publique la fuente. |
| D279 | Change 41, pregunta 8: contacto con el BCB | Ídem → (a) | Si los términos del sitio del BCB no son claros, el owner (o quien designe) escribe al BCB; la fuente queda `IN_VERIFICATION` mientras tanto. |
| D280 | Change 41, pregunta 9: revisión del censo | Ídem → (a) | En cada release que toque el catálogo y como mínimo trimestral, con la fecha de corte de ASFI y un recordatorio en docs/38. |
| D281 | Change 41, pregunta 10: muestras de extractos | Ídem → (a) | Un PDF por entidad, por un canal fuera del repositorio; se hace la ficha de formato y se borra el PDF; ningún dato real se copia. |
| D282 | Change 41, tarea 8.3 (muestras de D255 y D281) | "adjunto 3 extractos bancarios" | El owner entregó **4** extractos (BCP, Banco Ganadero, BISA y BNB), no 3. Se tratan según D255 y D281, fuera del repositorio. Con fichas de al menos 3 entidades se cumple el umbral de D277 para proponer el change del parser de PDF. Las fichas las hace otra sesión (tarea 8.3). |

## Pendiente del owner

1. Abrir la red del entorno a los dominios de los exchanges, de ASFI y del BCB, o hacer la lectura desde su máquina o el VPS N1 (D258, D260); hasta entonces `FX_PROVIDER_CRYPTO_*` y `FX_PROVIDER_INSTITUTION_RATES` siguen en `none`.
2. Activar Dependabot alerts (solo alertas) en la configuración del repositorio (D265).
3. Escribir al BCB si sus términos no son claros (D279), cuando la tarea 1.1 del change 41 lo determine.

Ninguna sesión cambia la protección de `main` ni los checks requeridos (D224, CLAUDE.md).
