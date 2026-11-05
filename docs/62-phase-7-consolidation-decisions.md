# 62: Decisiones del owner de la consolidación de Phase 7

> **Fecha:** 2026-11-04 · **Relacionado:** [61-phase-7-consolidation-questions.md](61-phase-7-consolidation-questions.md) (pregunta N → D(360+N)), [03-openspec-strategy.md](03-openspec-strategy.md) §7

El owner pidió avanzar sin interrupciones adoptando las recomendaciones («avancemos»): las 40 preguntas, incluidas las 7 bloqueantes, se resuelven con la recomendación de cada borrador. Cualquiera es revertible antes de que se implemente el grupo de tareas que la usa. Las specs ya estaban escritas con las recomendaciones.

| ID | Pregunta | Decisión |
|---|---|---|
| D361 | Q1 Read models de FR-REPORTING-007 | Se acepta (a): Lectura por conjunto sin read models ni consumidores, con métrica y alerta que recomiendan un read model por reporte — Bloquea el grupo 5 (infraestructura). |
| D362 | Q2 Partición en dos changes | Se acepta (a): Núcleo Must aquí y reportes Should, vistas guardadas y PDF en `add-financial-reports-extended` — Bloquea solo el orden (este change va primero). |
| D363 | Q3 Agrupación por omisión | Se acepta (a): Periodo financiero — , con el Home enlazando en mes calendario. No bloquea. |
| D364 | Q4 USDT en la descomposición del patrimonio | Se acepta (a): Agrupar por tipo de moneda (`FIAT` cambiaria; las demás, incluido USDT, de activos) y mostrar siempre la revalorización por moneda — la línea "USDT" responde "¿subió porque ahorré o porque subió el USDT?" sin configuración nueva. No bloquea. |
| D365 | Q5 Auditoría de las exportaciones de reportes | Se acepta (a): Auditarlas — No bloquea (requirement Should). |
| D366 | Q6 Separador del CSV | Se acepta (a): Coma y punto decimal, igual que las exportaciones actuales — ahora; (b) como change propio para todas las exportaciones a la vez. No bloquea. |
| D367 | Q7 D55: endpoint `kpis` y destino de `summary` | Se acepta (a): No crear `kpis`: `summary` sigue siendo el endpoint del Home, sin `Sunset` — ; `add-cash-flow-forecast` también lo da por resuelto aquí (su tabla de dependencias). No bloquea. |
| D368 | Q8 Gráficos | Se acepta (a): Componentes SVG propios — para este change; revisar en el change hermano (treemap y heatmap). No bloquea. |
| D369 | Q9 Fila del nightly con YoY y promedio móvil de 12 | Se acepta (a): Bloqueante desde el inicio — No bloquea la spec. |
| D370 | Q10 Exportaciones grandes | Se acepta (a): Síncronas con tope de 50 000 filas y `REPORT_EXPORT_TOO_LARGE` — No bloquea. |
| D371 | Q11 Orden respecto del núcleo | Se acepta (a): Implementar después de `add-financial-reports` archivado — Bloquea el orden de implementación. |
| D372 | Q12 Intereses de tarjeta en el reporte de comisiones y en la evolución de deudas | Se acepta (a): Contarlos si `debt/credit-cards` los registra como porciones con un rol identificable; si no, mostrar solo el saldo pendiente de la tarjeta — . No bloquea la spec; se verifica al implementar el grupo 3. |
| D373 | Q13 Auditoría de las vistas guardadas | Se acepta (a): Sin auditoría — No bloquea. |
| D374 | Q14 Vistas guardadas en el export del workspace | Se acepta (a): Incluirlas — No bloquea. |
| D375 | Q15 Filas del nightly de los reportes ampliados | Se acepta (a): Bloqueantes — No bloquea. |
| D376 | Q16 PDF en Phase 7 | Se acepta (a): Implementarlo en este change si el resto está terminado (Could) — No bloquea. |
| D377 | Q17 Modo por omisión del horizonte de Q5 | Se acepta (a): mantener el periodo financiero por omisión y ofrecer "hasta el próximo ingreso" como ajuste — — CF 1 |
| D378 | Q18 Dónde vive la marca de categoría esencial | Se acepta (a): lista propia de REPORTING en los ajustes del disponible — ; si el owner quiere usarla en reportes, (b) en un change posterior migra la lista. |
| D379 | Q19 Estimados en la serie principal | Se acepta (a): la serie principal incluye conocidos, estimados y esperados — coherente con Q4/Q5, que ya cuentan los estimados. |
| D380 | Q20 Aviso de riesgo resuelto | Se acepta (a): sin notificación al cerrar el episodio — , para no duplicar avisos; el calendario lo muestra. |
| D381 | Q21 Horizonte y cadencia de la alerta | Se acepta (a): 30 días, cada hora — el mismo horizonte que la tarjeta Q8, y la hora siguiente al job de ocurrencias. |
| D382 | Q22 Destinatarios de la alerta de déficit | Se acepta (a): OWNER y EDITOR — es una alerta accionable; el VIEWER la ve en Q8. |
| D383 | Q23 Reparto del gasto planificado | Se acepta (a): restante repartido en partes iguales por día hasta el fin del periodo, descontando compromisos de la misma categoría — — CF 7 |
| D384 | Q24 Riesgo `LOW` con margen del 10 % de los egresos | Se acepta (a): margen de docs/14 — en Phase 7; (b) si resulta ruidoso. |
| D385 | Q25 Digest: valor por omisión y horario | Se acepta (a): desactivado por omisión — (opt-in por privacidad, RISK-010). |
| D386 | Q26 Porcentajes y fechas en el digest sin opt-in | Se acepta (a): sin opt-in se muestran cantidades, porcentajes — un porcentaje no revela montos y da sentido al resumen. |
| D387 | Q27 Esenciales de periodos posteriores en el horizonte por ingreso | Se acepta (a): proporcional a los días dentro del horizonte — el gasto esencial se reparte en el mes. |
| D388 | Q28 Aportes planificados de periodos posteriores en el horizonte por ingreso | Se acepta (a): planificado completo de cada periodo alcanzado — un aporte mensual se hace de una vez. |
| D389 | Q29 Variación por categoría (Q7) aquí o en reportes financieros | Se acepta (a): en este change, como campo aditivo del resumen — cierra Q7 para SM-05 sin esperar al catálogo, y `add-financial-reports` ya la deja fuera de su alcance para este change; solo falta la confirmación del owner y coordinar el nombre del campo. |
| D390 | Q30 ¿FR-PLANNING-021 como método de sugerencia o como tipo de línea? | Se acepta (a): método de sugerencia que fija un monto tras la confirmación, con la base guardada — cumple "revisable, no automática", no mueve planes aprobados y no complica los umbrales. Bloquea los grupos 2 a 6. |
| D391 | Q31 ¿Periodos "cerrados" (literal de FR) o "terminados"? | Se acepta (a): terminados, cerrados o no, con la marca de cerrado en la explicación — el owner aún no cerró meses reales, y (b) dejaría la función sin datos. No bloquea: es un filtro en `HistoricalBudgetEstimator`. |
| D392 | Q32 Valores por omisión y método de atípicos | Se acepta (a): aceptarlos — . No bloquea. |
| D393 | Q33 ¿Borrador persistido? | Se acepta (a): vista previa sin estado y confirmación en la misma sesión — . No bloquea. |
| D394 | Q34 Prioridad | Se acepta (a): subir average/historical a Should para Phase 7 — con la historia que ya dejan los imports de Phase 6 es la mejora más barata del plan mensual. No bloquea el diseño, sí el orden de implementación de Phase 7. |
| D395 | Q35 Evidencia anterior al motor de reglas | Se acepta (a): contarlas cuando su categoría no es "sin categoría" y su `source` es `MANUAL` o `IMPORT` — . No bloquea: es un filtro de `listEvidence`. |
| D396 | Q36 Umbrales y ventana | Se acepta (a): aceptarlos — . No bloquea. |
| D397 | Q37 Alcance de lo sugerido | Se acepta (a): solo categoría — para Phase 7; (c) puede volver como mejora si el owner prefiere ese mecanismo. No bloquea. |
| D398 | Q38 Acciones diferidas por D335 | Se acepta la recomendación: se retira «vincular a meta» de FR-RULES-005 (solo se vinculan transferencias y las reglas no actúan sobre ellas, D336; las sugerencias de aporte ya cubren el caso) y «split por porcentajes» pasa al backlog hasta que haya un caso real. Phase 7 no suma un change por esto. |
| D399 | Q39 Prioridad | Se acepta (a): subir a Should para Phase 7 — . No bloquea el diseño, sí el orden de implementación. |
| D400 | Q40 D221: `add-commodity-prices` (42) y `add-asset-valuations` (43) | Se acepta (a): Pasarlos al backlog y reactivarlos solo si el owner adquiere esos activos — la descomposición del patrimonio (D242) sigue en `reporting/financial-reports` sin necesitarlos. |
