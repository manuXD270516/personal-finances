## MODIFIED Requirements

### Requirement: Volumen de eventos de un import grande
Un import de 5 000 filas DEBE (MUST) llegar a la vista previa en 30 segundos o menos y persistirse en 20 segundos o menos en el entorno de referencia, y los eventos que generan sus transacciones DEBEN (MUST) quedar procesados por cada consumidor en 120 segundos o menos; el import NO DEBE (MUST NOT) publicar eventos propios por fila: la cantidad de eventos propios de una importación DEBE (MUST) ser la misma con 4 filas que con 5 000.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Must

#### Scenario: Extracto de 5 000 filas
- **CUANDO** un EDITOR importa un CSV de 5 000 filas nuevas y lo aprueba
- **ENTONCES** la vista previa estuvo disponible en 30 segundos o menos desde la subida y las 5 000 transacciones existen en 20 segundos o menos desde la aprobación
- **Y** cada consumidor de eventos termina de procesar los eventos de esas transacciones en 120 segundos o menos
- **Y** la importación publicó exactamente 2 eventos propios

#### Scenario: Eventos propios independientes de la cantidad de filas
- **CUANDO** un EDITOR importa y aprueba un CSV de 4 filas y otro de 5 000 filas en la misma cuenta
- **ENTONCES** cada importación publicó los mismos 2 eventos propios, de aprobación y de fin
- **Y** ninguno de los eventos propios corresponde a una fila
