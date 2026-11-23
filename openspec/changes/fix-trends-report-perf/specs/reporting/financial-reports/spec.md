## ADDED Requirements

### Requirement: Cálculo de las tendencias sin recorrer los hechos por cada celda
El reporte de tendencias mensuales DEBE (MUST) devolver exactamente la misma respuesta que su definición funcional (las mismas series en el mismo orden, con las mismas celdas, totales, montos por moneda, consolidado exacto, completitud y montos sin convertir), y su cálculo NO DEBE (MUST NOT) crecer con el producto entre la cantidad de gastos leídos del rango y la cantidad de series y periodos: cada gasto leído DEBE (MUST) asignarse a su serie y su periodo una sola vez, y la valoración de cada celda y de cada total DEBE (MUST) hacerse sobre los gastos ya acumulados por día y moneda de esa celda o serie, con la tasa del día que corresponda.
Trace: FR-REPORTING-008, NFR-PERF-006 · Priority: Should

#### Scenario: Misma respuesta que antes con gastos en varias monedas
- **CUANDO** el rango de 24 meses tiene gastos en 9 categorías de primer nivel, en BOB, USD y USDT, con 100.00 USD gastados el 2026-03-10 en "Supermercado" con tasa USD/BOB 9.80 de ese día, y un gasto de 0.00100000 BTC el 2026-04-02 sin tasa
- **ENTONCES** el reporte informa las mismas 7 series y "Otras categorías", con las mismas celdas y totales que antes del cambio
- **Y** la celda de "Supermercado" de 2026-03 incluye 980.00 BOB por esos 100.00 USD y la respuesta queda incompleta con 0.00100000 BTC sin convertir

#### Scenario: Costo lineal en los gastos leídos
- **CUANDO** se calculan las tendencias de 24 periodos con 20 000 gastos acumulados por día, categoría y moneda
- **ENTONCES** cada uno de esos 20 000 gastos se lee una cantidad acotada de veces, independiente de los 24 periodos y de las 8 series
