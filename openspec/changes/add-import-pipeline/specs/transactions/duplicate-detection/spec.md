## ADDED Requirements

### Requirement: Puntaje de posible duplicado para filas importadas
Para cada candidato de una fila importada, el sistema DEBE (MUST) calcular un puntaje entre 0 y 1, con 4 decimales y redondeo HALF_EVEN, como 0.40 × monto + 0.25 × fecha + 0.20 × descripción + 0.10 × contraparte + 0.05 × origen, donde monto vale 1 con el mismo monto; fecha vale 1 el mismo día, 0.8 a un día, 0.5 a dos y 0.3 a tres; descripción es la similitud de las descripciones normalizadas (0.5 si el candidato no tiene descripción); contraparte vale 1 si ambas la tienen y coinciden, 0 si ambas la tienen y difieren y 0.5 en otro caso; y origen vale 0 si el candidato tiene un identificador del banco distinto del de la fila y 1 en otro caso. Los candidatos DEBEN (MUST) ordenarse por puntaje descendente, luego por menor diferencia de días y luego por identificador, y el mismo conjunto de datos DEBE (MUST) dar siempre los mismos puntajes y el mismo orden.
Trace: FR-TRANSACTIONS-032, FR-IMPORTS-007 · Priority: Must

#### Scenario: Gasto manual del día siguiente con la misma descripción
- **CUANDO** la fila "SUPERMERCADO DEMO" de 245.30 BOB de salida del 2026-10-01, sin contraparte, tiene como candidato un gasto manual de 245.30 BOB "Supermercado Demo" del 2026-10-02 sin identificador del banco
- **ENTONCES** el puntaje del candidato es 0.9000

#### Scenario: Candidato con otro identificador del banco
- **CUANDO** el mismo candidato proviene de otro import y tiene un identificador del banco distinto del de la fila
- **ENTONCES** el puntaje del candidato es 0.8500

#### Scenario: Desempate determinista
- **CUANDO** una fila tiene dos candidatos con el mismo puntaje, uno a un día y otro a dos días
- **ENTONCES** el candidato a un día va primero
- **Y** calcular de nuevo la vista previa da el mismo orden

### Requirement: Una transacción viva por identificador externo
Transactions DEBE (MUST) garantizar que en una cuenta exista a lo sumo una transacción no anulada por cada referencia externa importada (espacio de nombres de la institución y el formato, más el identificador), también cuando dos importaciones con la misma referencia se persisten a la vez; anular esa transacción DEBE (MUST) liberar la referencia para un import posterior.
Trace: FR-TRANSACTIONS-032, FR-IMPORTS-010 · Priority: Must

#### Scenario: Mismo identificador en dos importaciones simultáneas
- **CUANDO** dos importaciones de "Banco BOB" aprobadas a la vez traen el movimiento con identificador "2026030100017"
- **ENTONCES** existe una sola transacción no anulada con esa referencia en "Banco BOB"
- **Y** la otra importación lo informa como ya importado

#### Scenario: Referencia liberada al anular
- **CUANDO** la transacción importada con el identificador "2026030100017" se anula y el OFX se vuelve a importar
- **ENTONCES** la fila es nueva y al aprobar se crea una transacción con esa referencia

### Requirement: Vinculación preseleccionada de confianza alta
Cuando una fila tiene un único candidato con puntaje de 0.9000 o más y ningún otro candidato llega a 0.9000, el sistema DEBERÍA (SHOULD) preseleccionar la decisión de vincular la fila a ese candidato, que el usuario puede cambiar; con dos o más candidatos de 0.9000 o más NO DEBE (MUST NOT) preseleccionar ninguno; y un candidato con puntaje menor que 0.6000 DEBE (MUST) mostrarse como de confianza baja, sin preselección y exigiendo igualmente una decisión.
Trace: FR-TRANSACTIONS-032 · Priority: Should

#### Scenario: Único candidato de confianza alta
- **CUANDO** la fila del supermercado tiene un único candidato de puntaje 0.9000
- **ENTONCES** la fila aparece con la decisión de vincular a ese gasto ya seleccionada y editable

#### Scenario: Dos candidatos de confianza alta
- **CUANDO** una fila tiene dos candidatos de puntajes 0.9500 y 0.9000
- **ENTONCES** no hay decisión preseleccionada y la fila cuenta como pendiente de decisión

#### Scenario: Candidato de confianza baja
- **CUANDO** el único candidato de una fila de 245.30 BOB está a 3 días, con descripción sin similitud, sin contrapartes y sin identificador del banco, con puntaje 0.5750
- **ENTONCES** la fila es un posible duplicado de confianza baja sin decisión preseleccionada
- **Y** la aprobación sigue exigiendo una decisión para esa fila

### Requirement: Resolución registrada de un posible duplicado
El usuario DEBE (MUST) poder resolver cada posible duplicado conservando ambas (crear la fila), fusionándolos (omitir la fila vinculándola al movimiento existente, sin modificar ese movimiento) o excluyendo la fila sin recordarla; la decisión DEBE (MUST) guardarse con su actor, su instante y el puntaje del candidato elegido. Una fila fusionada o creada DEBE (MUST) clasificarse como ya importada en las importaciones siguientes; una fila excluida NO DEBE (MUST NOT) recordarse y DEBE (MUST) volver a mostrarse como posible duplicado.
Trace: FR-TRANSACTIONS-032, FR-IMPORTS-007 · Priority: Must

#### Scenario: Fusionar con el gasto manual
- **CUANDO** el EDITOR fusiona la fila "SUPERMERCADO DEMO" de 245.30 BOB con el gasto manual de 245.30 BOB del 2026-10-02 y aprueba
- **ENTONCES** no se crea ninguna transacción para esa fila
- **Y** el gasto manual conserva su monto, su descripción, su fecha y su estado posteado
- **Y** la decisión queda guardada con el EDITOR, el instante y el puntaje 0.9000

#### Scenario: Conservar ambas
- **CUANDO** el EDITOR decide crear la fila a pesar del candidato, aprueba y luego reimporta el mismo archivo
- **ENTONCES** la primera importación crea un gasto de 245.30 BOB y el gasto manual sigue igual
- **Y** en la reimportación la fila se clasifica como ya importada

#### Scenario: Excluir sin recordar
- **CUANDO** el EDITOR excluye la fila, aprueba y luego reimporta el mismo archivo
- **ENTONCES** no se crea ninguna transacción para esa fila
- **Y** en la reimportación la fila vuelve a ser un posible duplicado del gasto manual

### Requirement: Duplicados dentro del mismo archivo
Dentro de un mismo archivo, una fila con el mismo identificador externo único que otra anterior DEBE (MUST) clasificarse como ya importada haciendo referencia a la línea de la primera y NO DEBE (MUST NOT) crearse; las filas idénticas sin identificador externo DEBEN (MUST) seguir siendo filas distintas.
Trace: FR-IMPORTS-007, FR-TRANSACTIONS-032 · Priority: Must

#### Scenario: Mismo identificador dos veces en un archivo
- **CUANDO** un OFX trae en las líneas 40 y 95 el movimiento con identificador "A1" de 50.00 BOB
- **ENTONCES** la fila de la línea 95 se clasifica como ya importada con referencia a la línea 40
- **Y** al aprobar se crea una sola transacción de 50.00 BOB

#### Scenario: Filas idénticas sin identificador
- **CUANDO** un CSV sin columna de referencia trae dos veces "02/10/2026;PAGO QR CAFÉ;-18,00"
- **ENTONCES** ambas filas son nuevas y al aprobar se crean dos gastos de 18.00 BOB

### Requirement: Vínculos que dejan de valer al deshacer un import
Deshacer una importación DEBE (MUST) dejar sin efecto los vínculos de sus filas, tanto los de las transacciones que creó como los de las filas que fusionó con movimientos existentes, de modo que una importación posterior del mismo archivo vuelva a mostrar esas filas como nuevas o como posibles duplicados.
Trace: FR-IMPORTS-012, FR-TRANSACTIONS-032 · Priority: Should

#### Scenario: Deshacer olvida la fusión
- **CUANDO** una importación creó 2 gastos y fusionó una fila con el gasto manual de 245.30 BOB, se deshace y luego se reimporta el mismo archivo
- **ENTONCES** las 2 filas de los gastos anulados son nuevas
- **Y** la fila fusionada vuelve a ser un posible duplicado del gasto manual
