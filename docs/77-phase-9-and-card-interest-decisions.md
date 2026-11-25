# 77: Decisiones del owner sobre Phase 9, los intereses de tarjeta y el contrato de la vista previa del import

> **Fecha:** 2026-11-25 · **Preguntas:** [docs/76](76-phase-9-and-card-interest-questions.md) (pregunta N → D(464+N)) · **Relacionado:** [docs/03](03-openspec-strategy.md) §7, [docs/38](38-estado-y-pendientes.md), [docs/62](62-phase-7-consolidation-decisions.md) (D372, D395–D399), [docs/66](66-phase-8-consolidation-decisions.md) (D442), [15-ml-architecture.md](15-ml-architecture.md) §12, [24-roadmap.md](24-roadmap.md) §5.9, [25-product-backlog.md](25-product-backlog.md) EPIC-26

El owner contestó el 2026-11-25, en el chat, las cuatro preguntas bloqueantes (1, 8, 9 y 12), todas con la recomendación. Las otras 15 no las contestó. docs/76 fija la convención para ellas: «Las demás se implementan con la recomendación si el owner no responde antes del grupo de tareas que las usa». Por eso se registran como **sin respuesta del owner; se aplica la recomendación por defecto, según la convención de docs/76**. El owner puede revertir cualquiera de ellas antes de que se implemente el grupo de tareas que la usa.

## Decisiones contestadas por el owner

| Id | Pregunta de docs/76 | Decisión | Efecto |
|---|---|---|---|
| D465 | 1 [B]: cómo se modela un cargo de tarjeta | (a) El cargo de tarjeta es un gasto (`EXPENSE`) administrado por la tarjeta, con una porción por componente en su categoría de sistema y la marca `debtRole = CARD_CHARGE` en la transacción. | Desbloquea la implementación del change 70 [`add-card-interest-ledger-portions`](../openspec/changes/archive/2026-11-25-add-card-interest-ledger-portions/design.md). El change ya estaba redactado con esta opción (decisión 1 de su design), así que no hay que ajustarlo. |
| D472 | 8 [B]: alcance y orden de Phase 9 | (a) Se aprueba la tabla de docs/03 §7: 70 → 71 → 72 → 73 → 74 → 75 → 76. El 75 depende de la pregunta 17 y el 76 de la 16. Las automatizaciones, el split por porcentajes y los commodities quedan en el backlog. | Se redactan los changes 72, 73 y 74. 72 a 74 se construyen y prueban con el Large Seed, y su criterio de salida queda a la espera de la historia real del owner, como en Phase 8. |
| D473 | 9 [B]: método de las anomalías | (c) Estadística robusta (MAD) en TypeScript dentro de FORECAST desde ahora, en un trabajo diario dentro de `forecasting.schedule`. El modelo en Python queda como mejora para cuando el servicio esté habilitado. | Change 72 [`add-spending-anomaly-detection`](../openspec/changes/add-spending-anomaly-detection/design.md): no depende del servicio `finance-ml` ni de `FORECASTING_ENABLED`, y no suma consumidores ni conexiones (D249). Isolation Forest queda fuera de este change. |
| D476 | 12 [B]: clasificación automática | (a) Sugerencia de categoría por historial en TypeScript, reutilizando la `DescriptionKey` de las sugerencias de reglas (D395–D399). Corre después de las reglas y nunca se aplica sin confirmación. | Change 73 [`add-category-suggestions`](../openspec/changes/add-category-suggestions/design.md). El clasificador del servicio Python (opción b) queda como mejora si (a) no alcanza el umbral de D477. |

## Decisiones por omisión (sin respuesta del owner)

Sin respuesta del owner; se aplica la recomendación por defecto, según la convención de docs/76. Cada una se puede revertir antes del grupo de tareas que la usa.

| Id | Pregunta de docs/76 | Recomendación aplicada | Dónde se usa |
|---|---|---|---|
| D466 | 2: componentes de un cargo | (a) Interés, comisiones, seguro e impuestos, en las categorías de sistema «Intereses pagados», «Comisiones», «Seguros» e «Impuestos». El interés penal se distingue con una etiqueta. | Change 70 (ya redactado así) |
| D467 | 3: datos históricos | (a) Sin backfill automático. El histórico se marca con «Adoptar como cargo», sin transacciones nuevas ni cambios de saldo. | Change 70 (ya redactado así) |
| D468 | 4: anular un cargo adoptado | (a) Se anula su transacción, igual que un cargo registrado. | Change 70 (ya redactado así) |
| D469 | 5: datos demo | (a) Un cargo de interés en una tarjeta del Demo v2 y se regenera su golden (tarea Could 7.4). | Change 70 (ya redactado así) |
| D470 | 6: corrección de `ImportProposedField.value` | (c) Un esquema por tipo de campo. | Change 71 `fix-import-proposed-field-schema`, ya implementado y fusionado (#281) |
| D471 | 7: FR para EPIC-26 | (a) Se agregan a docs/01 FR redactados desde las US al redactar cada change. | FR-CLASSIFICATION-014 (change 73) y FR-REPORTING-020 (change 74); FR-FORECAST-010 pasa a la capability `forecast/anomaly-detection` (change 72) |
| D474 | 10: cómo se informa una anomalía | (a) Una lista «Gastos atípicos» con el motivo y una marca en la transacción, más un aviso por el puerto de notificaciones en proceso, apagado por omisión. Nunca bloquea ni modifica la transacción. | Change 72 |
| D475 | 11: US-247 (cargos duplicados y cambios de precio) | (a) Se da por cubierta con la advertencia de duplicados y la detección de cambio de precio de las suscripciones. No se abre un change; (b) se revisa con el uso real. | Change 72 (fuera de alcance) |
| D477 | 13: umbral de la clasificación sugerida | (a) Precisión top-1 ≥ 85 % en un backtesting temporal (entrenar hasta el mes M y medir en M+1) sobre al menos 3 meses. Solo se sugiere con confianza ≥ 0,70. | Change 73 |
| D478 | 14: insights predictivos | (a) Un change solo para el riesgo de exceder un presupuesto: proyección del gasto de la línea al fin del periodo, visible en el plan y en el Home, con un aviso apagado por omisión y textos por plantilla (sin LLM). | Change 74 [`add-budget-overrun-risk`](../openspec/changes/add-budget-overrun-risk/design.md) |
| D479 | 15: automatizaciones (US-251, Could) | (a) Quedan en el backlog, fuera de Phase 9. | Ningún change |
| D480 | 16: fusión de categorías y contrapartes | (a) Se incluye al final de Phase 9 como change 76 si el owner lo necesita al ordenar sus categorías reales. | Change 76 (sin redactar hasta que haga falta) |
| D481 | 17: deuda de Phase 4 y de tarjetas | (a) Un change de seguimiento (75) con contratos aditivos y sin migraciones de datos. El job horario de metas se queda. | Change 75 `fix-phase-4-debt-followups` (sin redactar) |
| D482 | 18: MFA, retención y cadena de hashes de la auditoría | (a) Van al track de despliegue y al Hito H, no a Phase 9 de producto. Se corrige el rótulo en docs/01. | docs/01 (FR-IDENTITY-009, FR-AUDIT-007 y FR-AUDIT-008 pasan al Hito H) |
| D483 | 19: criterio de salida de las anomalías | (a) Precisión ≥ 0,60 y recall ≥ 0,70 sobre las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` del Large Seed, medidos en el nightly. La tasa de descarte del owner se informa como dato. | Change 72 |

## Qué cambia en la práctica

- **Change 70:** se puede implementar (D465). No cambia nada de lo redactado. Su tarea 1.1 registra D465–D469 y la marca quien lo implementa.
- **Phase 9:** quedan redactados 72, 73 y 74 ([docs/03](03-openspec-strategy.md) §7). Ninguno suma consumidores ni conexiones. Las anomalías corren dentro de `forecasting.schedule`, que se registra también con los pronósticos deshabilitados. El riesgo de presupuesto se evalúa dentro de `reporting.cash-flow-watch`. Las sugerencias de categoría se calculan a pedido.
- **Criterios de salida:** precisión y recall de las anomalías (D483) y precisión top-1 de las sugerencias (D477), medidos con el Large Seed en el nightly; la confirmación con los datos reales del owner queda pendiente, como en Phase 8.
- **docs/01:** se agregan FR-CLASSIFICATION-014 y FR-REPORTING-020, FR-FORECAST-010 pasa a `forecast/anomaly-detection` y se corrige el rótulo de FR-IDENTITY-009, FR-AUDIT-007 y FR-AUDIT-008 (Hito H).

## Respuestas posteriores, 2026-11-25

El owner contestó en el chat, el mismo 2026-11-25, dos preguntas abiertas del design del change 74 y dos dudas de cierre del change 73. Las dos del 74 coinciden con lo que el design ya proponía.

| Id | Origen | Decisión | Efecto |
|---|---|---|---|
| D484 | Change 74, design § «Preguntas abiertas»: ¿el riesgo «posible» también avisa? | El riesgo «posible» solo se muestra en el plan y en su tooltip, sin notificación. Solo avisa el paso a «probable». | Change 74 [`add-budget-overrun-risk`](../openspec/changes/add-budget-overrun-risk/design.md), decisión 7: sin cambios en lo redactado. |
| D485 | Change 74, design § «Preguntas abiertas»: ¿la proyección lineal del plan pasa a usar el cálculo del riesgo? | La proyección lineal de PLANNING (FR-PLANNING-024) se deja lineal por ahora; no se unifica con el cálculo del change 74. | Change 74, decisión 1: el riesgo sigue siendo una lectura de REPORTING superpuesta al plan. |
| D486 | Change 73: fila del nightly del backtesting de las sugerencias de categoría (Large Seed, precisión top-1 ≥ 0.85, D477) | La fila queda **bloqueante**. Si genera ruido en el nightly, se pasa a informativa hasta tener la medición con la historia real del owner (tarea 7.4). | Change 73 [`add-category-suggestions`](../openspec/changes/add-category-suggestions/tasks.md), tarea 5.3. |
| D487 | Change 73: cuándo se archiva | No se archiva hasta cerrar la tarea 7.4 (medición con los datos reales del owner) y hasta que estén archivados `add-rule-engine` y `add-rule-suggestions`, según la regla de archivado del repo (100 % de tareas y TC automatizados). | [docs/38](38-estado-y-pendientes.md) §1.6. |
