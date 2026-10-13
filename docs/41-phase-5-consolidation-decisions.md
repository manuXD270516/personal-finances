# 41 — Decisiones del owner de la consolidación de Phase 5

> **Estado:** Registrado (7 respuestas del owner, 1 pendiente, 7 sin efecto, 17 por omisión) · **Fecha:** 2026-10-13 · **Relacionado:** [40-phase-5-consolidation-questions.md](40-phase-5-consolidation-questions.md) (preguntas originales con contexto y opciones; pregunta N → D(218+N)), [39-phase-4-closure-and-phase-5-design.md](39-phase-4-closure-and-phase-5-design.md) Parte B (plan de changes), [37-phase-4-consolidation-decisions.md](37-phase-4-consolidation-decisions.md) (D153–D218), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [ADR-0025](adr/0025-fuentes-de-tipo-de-cambio-bolivia.md), [ADR-0027](adr/0027-destino-de-despliegue-inicial-vps-compose.md)

El owner respondió el 2026-10-13 las preguntas de alcance de [docs/40](40-phase-5-consolidation-questions.md). Numeración: la pregunta **N** de docs/40 es la decisión **D(218+N)** (P1 → D219 … P32 → D250); continúa la de docs/37 (D153–D218).

Cada decisión lleva su origen:

- **Owner:** respuesta explícita del owner (P1, P2, P3, P7, P8, P15, P30).
- **Pendiente:** el owner responderá después (P14).
- **Sin efecto por D221 (diferido):** pregunta que solo aplica a commodities o inversiones, que el owner no tiene (P19–P25). Si esos changes vuelven al plan, la pregunta se reabre tal como está en docs/40.
- **Por omisión (recomendación adoptada; el owner puede revertir):** el owner no respondió; se adopta la recomendación de docs/40 como decisión provisional para poder redactar los changes. No es una respuesta del owner: si la revierte antes de implementar el change que la usa, se corrige su spec; después, se tramita como corrección.

**Resumen de alcance (D221):** el owner tiene cripto distinta de USDT y **no** tiene commodities ni inversiones. Entra `add-crypto-rate-providers` (38); `add-commodity-prices` (42) y `add-asset-valuations` (43) se difieren a Phase 7 o al backlog. `add-exchange-house-rate-providers` (41) queda en espera de P14. El plan ajustado está en [docs/39](39-phase-4-closure-and-phase-5-design.md) §B.3.

## Alcance y cierre de Phase 4

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D219 | P1 Empezar Phase 5 con evidencias de Phase 4 pendientes | Owner | (a) Empezar Phase 5 ya. Phase 4 queda "Completa salvo evidencias del owner" (tabla del banco, D154, y metas reales), como Phase 2 con el cierre de mes. Ningún change de Phase 5 toca `debt/loans` ni `debt/amortization` hasta el archivado encadenado. |
| D220 | P2 "Todos los pares del owner" (criterio de salida) | Owner | (a) Pares configurables por workspace. Default: las monedas habilitadas en el workspace frente a la moneda base. El criterio de 30 días se mide sobre esa lista. |
| D221 | P3 Tenencias reales del owner | Owner | (b) Solo cripto distinta de USDT; sin commodities ni inversiones. Entra CR (38); CO (42) y AV (43) se difieren a Phase 7 o al backlog, intactos. Qué criptomonedas usa se configura en la app con D220 (no se registra en el repositorio). |
| D222 | P4 Change de correcciones de Phase 4 | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Change `fix-phase-4-gaps` al inicio de Phase 5 con el alcance de docs/40 P4, sin deltas de spec sobre `debt/loans` ni `debt/amortization` hasta el archivado. Sub-pregunta: anular un aporte con retiros posteriores se **avisa** (no se bloquea). |
| D223 | P5 Datos de demostración de Phases 3 y 4 | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Change `add-phase-4-demo-data` como último y opcional de Phase 5, solo si el resto está terminado. Al archivar `add-loans`, su tarea 8.3 (Could) se marca `[x]` con la nota "diferida a `add-phase-4-demo-data`", para no bloquear el archivado encadenado. |
| D224 | P6 Platform track de Phases 5–7 | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Change pequeño `add-dependency-updates` que modifica `platform/delivery-pipeline`: Renovate con agrupación semanal, sin automerge de majors, y nightly de rendimiento con seed `large`. No cambia la protección de `main`; si llegara a cambiar checks requeridos, requiere confirmación aparte del owner. |

## Precios cripto (`add-crypto-rate-providers`, 38)

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D225 | P7 Fuente de precios cripto | Owner | (a) API pública de datos de mercado de un exchange (sin clave; cierres diarios para el histórico) como principal, y un agregador u otro exchange como respaldo independiente. Cada fuente pasa antes del adapter una verificación de términos de uso y licencia registrada en ADR-0025 o en un ADR nuevo (NFR-COMP-007, RISK-023); si una no califica, se reemplaza por la siguiente candidata. |
| D226 | P8 Tipo de tasa para precios de mercado | Owner | (a) Tipo nuevo `MARKET` para precios spot, valor aditivo en `rateType` (`x-extensible-enum`) y en `fx.RateRecorded.v1`. `PARALLEL` conserva su significado. |
| D227 | P9 Moneda de cotización y pivote | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Registrar los pares cripto contra USDT (p. ej. BTC/USDT, ETH/USDT) y valorar en BOB con la tasa cruzada por pivote USDT (USDT/BOB paralela), ya especificada en `fx/market-rates` "solo para valoración". |
| D228 | P10 Frecuencia, obsolescencia y anomalías de cripto | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Polling 15 min y obsolescencia 60 min como D31; umbral de anomalía por clase de activo, configurable: 5 % para fiat y stablecoins, 10 % para cripto volátil. |
| D229 | P11 Histórico de precios cripto | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Backfill de cierres diarios desde la primera fecha en que el workspace tiene saldo en esa moneda, idempotente y completado a diario (como FR-FX-013). |
| D230 | P12 Quién configura los pares | Por omisión (recomendación adoptada; el owner puede revertir) | (a) OWNER y EDITOR, con auditoría. Quitar un par deja de consultarlo y conserva su histórico. |
| D231 | P13 Conversiones propias como observación de tasa (D26) | Por omisión (recomendación adoptada; el owner puede revertir) | (b) Cada conversión posteada se registra como observación `USER_CONVERSION` de su par (tasa efectiva), visible en el historial y usada por el análisis de costo, nunca para valorar. Cierra D26 sin cambiar la valoración (D29). Requiere un consumidor de `ConversionRecorded.v1`/`ConversionRevised.v1` en FX; se rige por D249. |

## Casas de cambio y bancos (`add-exchange-house-rate-providers`, 41)

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D232 | P14 Fuentes de casas de cambio o bancos | **Pendiente** | El owner indicará después qué casas de cambio o bancos usa. El change 41 queda **en espera**; no bloquea a los demás. Mientras tanto, el owner registra tasas `BANK` manuales cuando convierte (como hoy). |

## Alertas de tasas (`add-rate-feed-alerts`, 39)

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D233 | P15 Qué dispara la alerta de obsolescencia | Owner | (a) Por workspace y par configurado (D220): alerta cuando el par lleva más de N horas sin tasa fresca de ningún provider (default 6 h, configurable), una vez por episodio, con aviso de recuperación al volver. La alerta por falla no transitoria de un provider (opción (c) de docs/40) no entra en Phase 5; esa falla sigue visible en el estado de providers. |
| D234 | P16 Alerta de anomalía retenida | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Notificar una vez por muestra retenida, con enlace para confirmar o rechazar. |
| D235 | P17 Destinatarios y canal | Por omisión (recomendación adoptada; el owner puede revertir) | (a) OWNER y EDITOR; in-app siempre y email según preferencias, sin valores de tasa en el email (FR-NOTIFY-006). |
| D236 | P18 Anomalías sin confirmar durante mucho tiempo | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Se mantiene la regla de Phase 1: la muestra se retiene hasta confirmarla o rechazarla; la alerta de D234 reduce la espera. |

## Commodities y valoración de activos (`add-commodity-prices` 42, `add-asset-valuations` 43)

Los changes 42 y 43 quedan diferidos por D221. Estas preguntas no se deciden ahora y se reabren tal como están en docs/40 si alguno vuelve al plan.

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D237 | P19 Modelo de valoración de activos no monetarios | Sin efecto por D221 (diferido) | — |
| D238 | P20 Contexto dueño de las valoraciones manuales | Sin efecto por D221 (diferido) | — |
| D239 | P21 Commodities en el catálogo (y unidad de medida) | Sin efecto por D221 (diferido) | — |
| D240 | P22 Precio de commodities | Sin efecto por D221 (diferido) | — |
| D241 | P23 Costo para la ganancia no realizada | Sin efecto por D221 (diferido) | — |
| D242 | P24 Descomposición del cambio de patrimonio | Sin efecto por D221 (diferido) | Sigue en Phase 7 con los reportes avanzados (docs/39 §B.7). |
| D243 | P25 Efecto en Q1 y Q5 | Sin efecto por D221 (diferido) | — |

## Costo de conversiones (`add-conversion-cost-analysis`, 40)

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D244 | P26 Qué es "provider o canal" (FR-FX-011) | Por omisión (recomendación adoptada; el owner puede revertir) | (a) La contraparte de la conversión más el par de cuentas; sin contraparte se agrupan como "Sin canal". Sin cambios en TRANSACTIONS. |
| D245 | P27 Quién calcula | Por omisión (recomendación adoptada; el owner puede revertir) | (a) REPORTING compone desde una consulta pública de TRANSACTIONS sobre `ConversionDetail`; el requisito vive en `fx/conversion-pricing`. Como D231 hace que FX tenga las observaciones `USER_CONVERSION`, el design del change 40 reevalúa si el cálculo se apoya en ellas; esa elección es de diseño y no cambia el contrato de lectura. |
| D246 | P28 Promedios y periodo | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Promedio ponderado por monto convertido, en moneda base, por periodo financiero, con opción de mes calendario. |
| D247 | P29 Base del spread | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Usar la tasa de referencia registrada (FR-FX-007/008); las conversiones sin referencia se excluyen y se cuentan aparte. Recalcular contra compra o venta paralela queda como Could si existen las tasas del día. |

## Transversales

| ID | Pregunta | Origen | Decisión |
|---|---|---|---|
| D248 | P30 Worker encendido para el criterio de 30 días | Owner | (a) Hacer el despliegue N1 (ADR-0027, VPS) **antes** de iniciar la ventana de 30 días. La ventana empieza el día en que N1 consulta los providers de forma continua; la implementación no espera al despliegue. |
| D249 | P31 Presupuesto de conexiones (55 de 60) | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Las alertas de obsolescencia reutilizan el job de providers (sin consumidor nuevo). El consumidor de conversiones de D231 es el único nuevo previsto: antes de agregarlo se sube `max_connections` y se valida el test de arranque del worker, en el mismo change que lo introduce. |
| D250 | P32 Recorrido (D37) de los agregados nuevos | Por omisión (recomendación adoptada; el owner puede revertir) | (a) Sin máquina de estados para los pares configurados; solo auditoría (como D178). |

## Pendiente del owner

1. **P14 (D232):** qué casas de cambio o bancos usa, para verificar sus términos y decidir si el change 41 entra. Bloquea solo ese change.
2. **Despliegue N1 (D248):** necesario antes de abrir la ventana de 30 días del criterio de salida; bloquea el cierre de la fase, no la implementación.
3. **Revisión de las decisiones por omisión** (D222–D224, D227–D231, D234–D236, D244–D247, D249, D250): el owner puede revertir cualquiera; conviene hacerlo antes de que se redacte el change que la usa (orden en docs/39 §B.3).
