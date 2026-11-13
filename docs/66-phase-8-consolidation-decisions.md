# 66: Decisiones del owner de la consolidación de Phase 8

> **Fecha:** 2026-11-12 · **Relacionado:** [65-phase-8-consolidation-questions.md](65-phase-8-consolidation-questions.md) (pregunta N → D(409+N)), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [ADR-0033](adr/0033-servicio-de-pronosticos-en-python-en-n1.md)

El owner respondió en la sesión las 6 preguntas bloqueantes (1, 2, 3, 4, 10 y 26) eligiendo la opción recomendada en cada una, y aceptó las recomendaciones de las 27 restantes. ADR-0033 pasa a **Aceptado** (D410). El check obligatorio `ml` (D419) es un cambio de la configuración de seguridad del repositorio confirmado por el owner; se aplica en la tarea 8.3 del change 64.

| ID | Pregunta | Decisión |
|---|---|---|
| D410 | Q1 Aceptar ADR-0033 (servicio Python en N1) | Se acepta (a): Servicio Python `finance-ml` sin estado ni credenciales de datos, un proceso, `POST /v1/forecasts` síncrono, perfil `ml` opcional y deshabilitado por omisión en N1 — cumple «el core sin ML» y no cuesta nada mientras está apagado. |
| D411 | Q2 Momento de Phase 8 sin historia real | Se acepta (a): Implementar ahora 64 → 65 → 66 con datos sintéticos y el servicio deshabilitado en N1; habilitarlo cuando su historia pase la preparación; implementar 67 cuando haya al menos 3 periodos con pronóstico real — el código queda probado con datos sintéticos y el criterio de salida espera al owner como en las fases anteriores; el reporte de precisión no se puede validar sin meses reales. |
| D412 | Q3 Grano de las series | Se acepta (a): Periodo financiero del workspace — el pronóstico se compara con el presupuesto y el cierre, que son por periodo financiero. |
| D413 | Q4 ¿Periodos «cerrados» (FR-FORECAST-005) o «terminados»? | Se acepta (a): Terminados, cerrados o no — el owner aún no cerró meses reales y (b) dejaría la función sin datos durante meses. |
| D414 | Q5 Umbrales de la preparación de datos | Se acepta (a): Aceptarlos (configurables por entorno) — (docs/15 §4). No bloquea. |
| D415 | Q6 Moneda de las series | Se acepta (a): Gasto, ingreso, grupos y categorías en la moneda de reporte con la tasa de cada fecha; series por moneda nativa solo para el flujo de caja (change 66) — comparable con Q3 y el presupuesto; el calendario necesita la nativa y la tiene. No bloquea. |
| D416 | Q7 Conjunto de datos en la petición y sin guardarlo | Se acepta (a): En el cuerpo de la petición, sin guardarlo; reproducibilidad por hash + versión + semilla — el servicio no necesita credenciales de almacenamiento y no queda una copia más de datos financieros. No bloquea. |
| D417 | Q8 Credencial del servicio | Se acepta (a): Token aleatorio en un archivo 0400, `Bearer`, comparación en tiempo constante, red interna sin salida — . No bloquea. |
| D418 | Q9 Disparadores de las corridas | Se acepta (a): Trabajo diario: corrida si terminó un periodo nuevo o la vigente tiene más de 7 días, una por día; más la solicitud manual; sin consumir `planning.MonthClosed` — . No bloquea. |
| D419 | Q10 Checks obligatorios nuevos en `main` | Se acepta (a): Un solo check agregado `ml`, obligatorio, que pasa en verde cuando el PR no toca el servicio. |
| D420 | Q11 Retención de las corridas | Se acepta (a): La vigente y, por cada uno de los últimos 24 periodos, la última completada antes de su inicio; las demás reemplazadas a los 30 días; fallidas y sin datos a los 90 — el change 67 necesita la corrida que pronosticó cada periodo. No bloquea. |
| D421 | Q12 Portabilidad | Se acepta (a): Las corridas no viajan en la exportación del workspace; se recalculan — son derivadas. No bloquea. |
| D422 | Q13 Quién solicita corridas | Se acepta (a): OWNER y EDITOR; VIEWER solo lee — (como las demás acciones costosas). No bloquea. |
| D423 | Q14 Fila nightly de NFR-PERF-012 (corrida ≤ 5 min) | Se acepta (a): Bloqueante desde el inicio — . No bloquea. |
| D424 | Q15 Primer periodo pronosticado | Se acepta (a): El periodo en curso — . No bloquea. |
| D425 | Q16 Modelos candidatos de Phase 8 | Se acepta (a): Último periodo, promedios de 3/6/12, mismo periodo del año anterior (≥ 13), ETS con tendencia amortiguada (≥ 6) y ETS estacional (≥ 24); sin Prophet, regresión ni boosting — Prophet pesa y necesita ≥ 24 meses densos. No bloquea. |
| D426 | Q17 Regla de publicación | Se acepta (a): Un modelo se publica si su MASE es al menos 5 % menor que el de la mejor referencia; si no, se publica la referencia — (docs/15 §7). No bloquea. |
| D427 | Q18 Intervalos visibles | Se acepta (a): 80 % en la vista; 95 % calculado y en el detalle — . No bloquea. |
| D428 | Q19 Series de Phase 8 | Se acepta (a): Gasto total, grupos, categorías (con «Otras categorías») e ingreso total; sin pronóstico por cuenta — las tarjetas ya están en el calendario por sus pagos. No bloquea. |
| D429 | Q20 Re-selección del modelo | Se acepta (a): Automática en cada corrida, con modelo y versión visibles — . No bloquea. |
| D430 | Q21 Atípicos | Se acepta (a): Detección automática (MAD 3.5), señalada en los motivos y recortada solo para ajustar; sin exclusión manual — en Phase 8. No bloquea. |
| D431 | Q22 Feriados y aguinaldo | Se acepta (a): Sin regresores; la estacionalidad anual (≥ 24 periodos) captura diciembre — . No bloquea. |
| D432 | Q23 Qué cuenta como costo conocido | Se acepta (a): Ocurrencias de gasto o ingreso (incluidas suscripciones) y los componentes de gasto de las cuotas de préstamo; no los pagos de tarjeta, los aportes a metas, el capital ni las transferencias — el pago de tarjeta no es gasto (las compras ya lo son); contarlo duplicaría. No bloquea. |
| D433 | Q24 Evidencia del criterio de salida con datos reales | Se acepta (a): Un comando en su instancia que imprime solo métricas agregadas por tipo de serie (MASE, cobertura, cantidad), sin montos ni nombres, registrado en el change — . No bloquea el desarrollo. |
| D434 | Q25 Diferencia entre categorías y total | Se acepta (a): Series independientes; la vista informa la diferencia si supera el 5 % — . No bloquea. |
| D435 | Q26 Semántica del pronóstico en el calendario | Se acepta (a): Banda aparte (gasto esperado, alto y bajo) y una probabilidad de déficit propia; el riesgo, los episodios y la alerta no cambian — no mueve alertas que el owner ya usa y separa lo conocido de lo estimado. |
| D436 | Q27 Probabilidad de déficit | Se acepta (a): Niveles «probable» (la serie con gasto esperado baja del umbral), «posible» (solo la de gasto alto) e «improbable» — el porcentaje daría una precisión que las series personales no sostienen y obligaría a llamar al servicio en la lectura. No bloquea. |
| D437 | Q28 Reparto diario | Se acepta (a): Partes iguales por día; en el periodo en curso solo lo que falta (nunca negativo) entre hoy y el fin del periodo — (como D383). No bloquea. |
| D438 | Q29 El pronóstico en el Home | Se acepta (a): Q3 con el gasto esperado del periodo en curso y su rango; Q8 con la probabilidad de déficit en una línea aparte del riesgo — . No bloquea. |
| D439 | Q30 Métricas visibles | Se acepta (a): Error absoluto medio en la moneda y cobertura del 80 % en la vista; MASE y sesgo en el detalle — (docs/15 §8.2: el MAE se entiende). No bloquea. |
| D440 | Q31 Cuándo se evalúa un periodo | Se acepta (a): Pasados 5 días del fin del periodo; reevaluación de los 3 últimos si el real cambia — el owner todavía no cierra meses e importa extractos tarde. No bloquea. |
| D441 | Q32 Pérdida de precisión | Se acepta (a): Indicador en la vista (MASE > 1.2 tres periodos seguidos), sin notificación — evita fatiga de avisos y consumidores. No bloquea. |
| D442 | Q33 FR-FORECAST-010 (anomalías) | Se acepta (a): Moverla a Phase 9 y anotarlo en docs/01 — Phase 9 reúne anomalías, auto-clasificación (W-13) e insights sobre la base de Phase 8. No bloquea. |
