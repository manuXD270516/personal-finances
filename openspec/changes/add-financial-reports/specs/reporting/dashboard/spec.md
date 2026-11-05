## ADDED Requirements

### Requirement: Detalle de la comparación del Home en los reportes
La comparación con el mes anterior del Home (Q7) DEBE (MUST) ofrecer un enlace al reporte de ingresos y gastos del mismo periodo con la misma comparación "a la fecha" y la misma moneda de reporte, de modo que las cifras del reporte coincidan con las del Home.
Trace: FR-REPORTING-018, FR-REPORTING-009 · Priority: Should

#### Scenario: Del Home al reporte
- **CUANDO** hoy es 2026-10-15 y el Home informa un gasto de 1800.00 BOB con una variación de 20.00 % contra el mismo tramo de septiembre
- **ENTONCES** el enlace abre el reporte de ingresos y gastos de 2026-10 comparado a la fecha, que informa el mismo gasto de 1800.00 BOB y la misma variación
