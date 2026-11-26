# Spec Delta

## ADDED Requirements

### Requirement: Filas de muestra al retomar una importación esperando mapeo
La consulta de una importación que está "esperando mapeo" DEBE (MUST) devolver, además de su encabezado, hasta 20 filas de muestra posteriores al encabezado, las mismas que devolvió al crearla, para que el usuario pueda retomar el mapeo viendo el contenido del archivo. En cualquier otro estado la consulta NO DEBE (MUST NOT) devolver filas de muestra. El texto de la muestra DEBE (MUST) tratarse como no confiable y mostrarse siempre escapado.
Trace: FR-IMPORTS-003, FR-IMPORTS-001 · Priority: Should

#### Scenario: Retomar el mapeo de un extracto
- **CUANDO** un EDITOR subió para "Banco BOB" el archivo "extracto-octubre.csv" con el encabezado "Fecha;Descripción;Monto" y 4 filas de datos, cerró la pantalla y vuelve a abrir la importación, que sigue esperando mapeo
- **ENTONCES** la importación informa las columnas "Fecha", "Descripción" y "Monto" y las 4 filas de muestra
- **Y** la pantalla de mapeo muestra esas 4 filas sin el aviso de muestra no disponible

#### Scenario: Archivo con más de 20 filas
- **CUANDO** la importación que espera mapeo viene de un archivo con 150 filas de datos
- **ENTONCES** la consulta devuelve las primeras 20 filas de datos como muestra

#### Scenario: Importación ya mapeada
- **CUANDO** la misma importación ya está en revisión
- **ENTONCES** la consulta no devuelve filas de muestra

### Requirement: Mapeo sugerido al retomar una importación
La consulta de una importación que está "esperando mapeo" DEBE (MUST) devolver también el mapeo sugerido, el de la última importación de la misma cuenta, igual que al crearla, para que la pantalla de mapeo se precargue al retomar. Si la cuenta no tiene importaciones anteriores, o en cualquier otro estado, la consulta NO DEBE (MUST NOT) devolver un mapeo sugerido.
Trace: FR-IMPORTS-003 · Priority: Could

#### Scenario: Retomar con el mapeo de la importación anterior
- **CUANDO** "Banco BOB" tiene una importación anterior aprobada con las columnas "Fecha", "Descripción" y "Monto" mapeadas a fecha, descripción y monto, y un EDITOR retoma una importación nueva de esa cuenta que sigue esperando mapeo
- **ENTONCES** la consulta devuelve ese mapeo como sugerido y la pantalla de mapeo lo muestra precargado

#### Scenario: Cuenta sin importaciones anteriores
- **CUANDO** el EDITOR retoma la primera importación de "Banco USD", que sigue esperando mapeo
- **ENTONCES** la consulta no devuelve un mapeo sugerido y la pantalla de mapeo empieza vacía
