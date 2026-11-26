## MODIFIED Requirements

### Requirement: Gastos atípicos para su categoría
El sistema DEBE (MUST) marcar como atípica la porción de un gasto cuyo monto en la moneda de reporte, comparado con las porciones de gasto de la misma categoría de los 365 días anteriores a su fecha (sin contarse a sí misma), cumpla a la vez: puntaje robusto 0.6745 × (monto − mediana) / MAD de al menos el umbral configurado (por omisión 15) y monto de al menos la razón configurada (por omisión 3) veces la mediana, donde MAD es la mediana de las desviaciones absolutas respecto de la mediana. Con MAD igual a cero DEBE (MUST) bastar la segunda condición. Con menos porciones de historia en la categoría que el mínimo configurado (por omisión 8), la porción NO DEBE (MUST NOT) evaluarse por categoría. Los cálculos DEBEN (MUST) hacerse con Decimal y los valores mostrados redondearse con HALF_EVEN.
Trace: FR-FORECAST-010, NFR-DATA-001, NFR-DATA-002 · Priority: Should

#### Scenario: Cena muy por encima de lo habitual
- **CUANDO** "Restaurantes" tiene 12 gastos en los 365 días anteriores con mediana 80.00 BOB y MAD 7.50 BOB y el 2026-11-12 se registra un gasto de 304.00 BOB en "Restaurantes"
- **ENTONCES** el gasto queda marcado como atípico por categoría con 3.8 veces la mediana de "Restaurantes" y puntaje robusto 20.15

#### Scenario: Alto pero no tanto
- **CUANDO** con la misma historia se registra un gasto de 200.00 BOB en "Restaurantes"
- **ENTONCES** el gasto no se marca: el puntaje robusto es 10.79, menor que 15, y el monto es 2.5 veces la mediana

#### Scenario: Historia insuficiente
- **CUANDO** "Regalos" tiene 5 gastos en los 365 días anteriores y se registra un gasto de 900.00 BOB en "Regalos"
- **ENTONCES** el gasto no se evalúa por categoría

#### Scenario: Montos siempre iguales
- **CUANDO** "Lavandería" tiene 10 gastos de 40.00 BOB en los 365 días anteriores y se registra uno de 132.00 BOB
- **ENTONCES** el gasto queda marcado como atípico por categoría con 3.3 veces la mediana

#### Scenario: Gasto alto en una categoría dispersa
- **CUANDO** "Regalos y celebraciones" tiene 20 gastos en los 365 días anteriores con mediana 100.00 BOB y MAD 40.00 BOB y se registra un gasto de 450.00 BOB en "Regalos y celebraciones"
- **ENTONCES** el gasto no se marca: es 4.5 veces la mediana, pero el puntaje robusto es 5.90, menor que 15

### Requirement: Gastos atípicos para su contraparte
El sistema DEBE (MUST) aplicar el mismo criterio a cada gasto con contraparte, con el monto total del gasto en la moneda de reporte comparado con los gastos con esa contraparte **en la misma categoría principal** de los 365 días anteriores, con el mismo mínimo de historia. La categoría principal de un gasto DEBE (MUST) ser la categoría de su porción de mayor monto en la moneda de reporte, sin contar las porciones en «sin categoría» y, con empate, la de la primera porción; un gasto sin porciones categorizadas NO DEBE (MUST NOT) evaluarse por contraparte. Un gasto atípico por categoría y por contraparte DEBE (MUST) quedar como un solo gasto atípico con los dos motivos.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Atípico por contraparte y por categoría
- **CUANDO** los 10 gastos con "Pizzería Demo" en "Restaurantes" de los 365 días anteriores tienen mediana 95.00 BOB y MAD 8.00 BOB y el gasto de 304.00 BOB en "Restaurantes" es con "Pizzería Demo"
- **ENTONCES** hay un solo gasto atípico con dos motivos: 3.8 veces la mediana de "Restaurantes" y 3.2 veces la mediana de "Pizzería Demo" en "Restaurantes"

#### Scenario: Contraparte con gastos de otra categoría
- **CUANDO** "Hipermaxi" tiene 20 gastos en "Supermercado" en los 365 días anteriores con mediana 150.00 BOB y ninguno en "Electrónica", y se registra un gasto de 900.00 BOB en "Electrónica" con "Hipermaxi"
- **ENTONCES** el gasto no se evalúa por contraparte, porque "Hipermaxi" no tiene historia en "Electrónica"
- **Y** tampoco se evalúa como contraparte nueva, porque "Hipermaxi" tiene gastos en los 365 días anteriores

#### Scenario: Gasto con varias porciones
- **CUANDO** un gasto de 500.00 BOB con "Hipermaxi" tiene una porción de 380.00 BOB en "Supermercado" y otra de 120.00 BOB en "Artículos de limpieza"
- **ENTONCES** se evalúa por contraparte contra los gastos con "Hipermaxi" en "Supermercado", su categoría principal

### Requirement: Contraparte nueva con monto alto
El sistema DEBE (MUST) marcar como atípico un gasto cuya contraparte no tiene gastos, en ninguna categoría, en los 365 días anteriores y cuyo monto en la moneda de reporte es al menos el percentil configurado (por omisión 99.5, por rango más cercano) de todos los gastos del workspace de esos 365 días, cuando ese periodo tiene al menos el mínimo de historia configurado. Un gasto sin contraparte NO DEBE (MUST NOT) evaluarse con este criterio.
Trace: FR-FORECAST-010 · Priority: Should

#### Scenario: Compra grande con una tienda desconocida
- **CUANDO** el percentil 99.5 de los gastos de los 365 días anteriores es 900.00 BOB y el 2026-11-14 se registra un gasto de 1450.00 BOB con "Tienda Online Nueva", sin gastos previos
- **ENTONCES** el gasto queda marcado como atípico por contraparte nueva con monto alto

#### Scenario: Contraparte nueva con monto común
- **CUANDO** con el mismo percentil se registra un gasto de 120.00 BOB con otra contraparte nueva
- **ENTONCES** el gasto no se marca

### Requirement: Motivo explicable de cada gasto atípico
Cada gasto atípico DEBE (MUST) mostrar, por cada motivo, el criterio (categoría, contraparte en su categoría principal o contraparte nueva), la referencia (mediana o el percentil configurado en la moneda de reporte), la cantidad de gastos de historia y, por categoría y contraparte, cuántas veces la mediana es el monto con un decimal; el motivo por contraparte DEBE (MUST) nombrar también la categoría principal. El texto DEBE (MUST) generarse por plantilla, sin modelos de lenguaje, y NO DEBE (MUST NOT) presentar la marca como un error o un fraude confirmado.
Trace: FR-FORECAST-010, FR-FORECAST-004 · Priority: Should

#### Scenario: Texto del motivo
- **CUANDO** un gasto de 304.00 BOB en "Restaurantes" es atípico frente a una mediana de 80.00 BOB sobre 12 gastos
- **ENTONCES** el motivo dice que el gasto es 3,8 veces la mediana de "Restaurantes" (80,00 BOB en los últimos 12 meses, 12 gastos) con los formatos de es-BO

#### Scenario: Texto del motivo por contraparte
- **CUANDO** el mismo gasto también es atípico frente a la mediana de 95.00 BOB de los 10 gastos con "Pizzería Demo" en "Restaurantes"
- **ENTONCES** el motivo dice que el gasto es 3,2 veces la mediana de "Pizzería Demo" en "Restaurantes" (95,00 BOB en los últimos 12 meses, 10 gastos)

### Requirement: Evaluación contra las anomalías etiquetadas del Large Seed
El nightly DEBE (MUST) evaluar la detección sobre toda la historia del workspace principal del Large Seed a escala completa, cada gasto con sus 365 días anteriores y sin persistir resultados, contra las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` exportadas fuera de la base, y DEBE (MUST) fallar si la precisión es menor que 0.80 o el recall menor que 0.85; los gastos con otras etiquetas NO DEBEN (MUST NOT) contar en la precisión. El informe DEBE (MUST) incluir los umbrales usados y los gastos marcados sin etiqueta por criterio, y NO DEBE (MUST NOT) incluir montos ni descripciones. El runner de la evaluación DEBE (MUST) aceptar umbrales por argumento para una corrida, sin cambiar la configuración.
Trace: FR-FORECAST-010, FR-FORECAST-007 · Priority: Should

#### Scenario: Umbrales cumplidos
- **CUANDO** la evaluación marca 140 gastos, de los cuales 115 tienen etiqueta `OUTLIER` o `NEW_COUNTERPARTY_FRAUD`, 5 tienen otra etiqueta y 20 ninguna, y hay 125 gastos con esas dos etiquetas
- **ENTONCES** la precisión es 0.8519 (115 de 135), el recall 0.9200 (115 de 125) y la fila del nightly pasa

#### Scenario: Umbrales no cumplidos
- **CUANDO** la evaluación marca 140 gastos, de los cuales 100 tienen esas dos etiquetas, 10 tienen otra etiqueta y 30 ninguna, y hay 125 gastos con esas dos etiquetas
- **ENTONCES** la precisión es 0.7692 (100 de 130), el recall 0.8000 (100 de 125) y la fila del nightly falla
- **Y** el informe lista los 30 marcados sin etiqueta repartidos por criterio

#### Scenario: Rejilla con umbrales por argumento
- **CUANDO** se corre el runner de la evaluación con puntaje robusto 10 y percentil 99.5 por argumento
- **ENTONCES** el informe usa y muestra esos umbrales, y la configuración del worker no cambia
