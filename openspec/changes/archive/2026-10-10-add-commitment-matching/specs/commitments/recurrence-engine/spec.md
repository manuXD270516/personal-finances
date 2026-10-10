# Spec Delta

## ADDED Requirements

### Requirement: Sugerencia de coincidencia para una transacción registrada
Cuando se registra o importa una transacción no anulada que no fue creada por una ocurrencia, el sistema DEBE (MUST) buscar ocurrencias no resueltas compatibles y guardar, por cada una, una sugerencia de coincidencia con puntaje, nivel de confianza y motivos (diferencia de monto, diferencia de días y contraparte), sin modificar la ocurrencia ni la transacción; la búsqueda DEBE (MUST) ser idempotente ante entregas repetidas del mismo hecho.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Gasto manual sugerido para el internet
- **CUANDO** la ocurrencia del "Internet" de 199.00 BOB en "Banco BOB" vence el 2026-10-20 sin resolver y el usuario registra a mano un gasto de 199.00 BOB en "Banco BOB" el 2026-10-19 sin contraparte
- **ENTONCES** existe una sugerencia propuesta entre ese gasto y esa ocurrencia con confianza alta, diferencia de monto 0.00 BOB y diferencia de 1 día
- **Y** la ocurrencia sigue sin resolver

#### Scenario: Transacción sin ocurrencia compatible
- **CUANDO** el usuario registra un gasto de 45.90 BOB en "Efectivo" el 2026-10-19 y no hay ocurrencias de "Efectivo" en la ventana
- **ENTONCES** no se crea ninguna sugerencia

#### Scenario: Hecho entregado dos veces
- **CUANDO** el hecho de registro del gasto de 199.00 BOB del 2026-10-19 se entrega dos veces
- **ENTONCES** existe una sola sugerencia para ese par

### Requirement: Criterios de compatibilidad y tolerancias
Una ocurrencia DEBE (MUST) ser candidata de una transacción solo si tienen el mismo tipo, la misma cuenta (o el mismo origen y destino en transferencias) y la misma moneda, la fecha de negocio está a lo sumo a la ventana de días de la fecha de vencimiento (5 por defecto, configurable de 0 a 15 por definición), la contraparte no difiere cuando ambas la tienen y el monto cae dentro de la tolerancia del tipo de monto (por defecto `FIXED` ±2 %, `ESTIMATED` ±25 %, `MIN_MAX` el rango ampliado ±5 %, configurable por definición); para `VARIABLE` DEBE (MUST) exigirse además la misma contraparte.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Monto fuera de tolerancia
- **CUANDO** el "Internet" `FIXED` espera 199.00 BOB (tolerancia ±2 % = 3.98 BOB) y el gasto registrado es de 205.00 BOB
- **ENTONCES** no se sugiere la coincidencia

#### Scenario: Luz estimada dentro de tolerancia
- **CUANDO** la "Luz" `ESTIMATED` espera 150.00 BOB con vencimiento 2026-10-25 y se registra un gasto de 163.40 BOB en la misma cuenta el 2026-10-27
- **ENTONCES** se sugiere la coincidencia con diferencia de monto 13.40 BOB y de 2 días

#### Scenario: Contraparte distinta
- **CUANDO** la ocurrencia del "Internet" tiene contraparte "Tigo" y el gasto de 199.00 BOB tiene contraparte "Entel"
- **ENTONCES** no se sugiere la coincidencia

#### Scenario: Tolerancia configurada en la definición
- **CUANDO** el EDITOR configura en el "Internet" tolerancia 5 % y ventana 2 días, y se registra un gasto de 205.00 BOB el 2026-10-23
- **ENTONCES** no se sugiere la coincidencia porque la fecha está a 3 días del vencimiento
- **Y** un gasto de 205.00 BOB el 2026-10-21 sí se sugiere

### Requirement: El matching nunca vincula sin confirmación
Ninguna sugerencia DEBE (MUST) resolver una ocurrencia, vincular una transacción ni crear transacciones sin la confirmación explícita de un EDITOR u OWNER, cualquiera sea su confianza y el origen de la transacción (manual, importada o de otra fuente).
Trace: FR-COMMITMENTS-010, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Coincidencia exacta no se vincula sola
- **CUANDO** se importa un gasto de 199.00 BOB en "Banco BOB" con contraparte "Tigo" el 2026-10-20, idéntico a la ocurrencia del "Internet" de ese día
- **ENTONCES** se crea una sugerencia de confianza alta
- **Y** la ocurrencia sigue sin resolver y la transacción sin vincular hasta que el usuario confirme

### Requirement: Confirmar una sugerencia
El EDITOR u OWNER DEBE (MUST) poder confirmar una sugerencia propuesta, lo que DEBE (MUST) vincular la ocurrencia con la transacción con las mismas reglas que el vínculo manual, registrar que se vinculó por sugerencia y expirar las demás sugerencias propuestas de esa ocurrencia y de esa transacción, en una sola unidad de trabajo; una sugerencia que ya no está propuesta DEBE (MUST) rechazarse con `MATCH_SUGGESTION_NOT_PENDING` y un VIEWER con `INSUFFICIENT_ROLE`.
Trace: FR-COMMITMENTS-010, FR-COMMITMENTS-008 · Priority: Should

#### Scenario: Confirmar la sugerencia del internet
- **CUANDO** el EDITOR confirma la sugerencia entre el gasto de 199.00 BOB del 2026-10-19 y la ocurrencia del 2026-10-20 del "Internet"
- **ENTONCES** la ocurrencia queda vinculada a ese gasto por sugerencia y la sugerencia queda confirmada
- **Y** la ocurrencia sale del total comprometido de octubre

#### Scenario: Sugerencia ya resuelta por otra vía
- **CUANDO** el EDITOR aprobó la ocurrencia del "Internet" creando otro gasto y luego confirma la sugerencia anterior
- **ENTONCES** se rechaza con `MATCH_SUGGESTION_NOT_PENDING` y nada cambia

#### Scenario: VIEWER no confirma
- **CUANDO** un VIEWER confirma una sugerencia propuesta
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Descartar una sugerencia
El EDITOR u OWNER DEBE (MUST) poder descartar una sugerencia propuesta; el mismo par de ocurrencia y transacción NO DEBE (MUST NOT) volver a sugerirse aunque la transacción se edite o el hecho se entregue de nuevo, y descartar NO DEBE (MUST NOT) cambiar la ocurrencia ni la transacción.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Descartada no vuelve
- **CUANDO** el EDITOR descarta la sugerencia entre el gasto de 199.00 BOB del 2026-10-19 y la ocurrencia del "Internet" y luego edita la descripción de ese gasto
- **ENTONCES** no se crea una nueva sugerencia para ese par
- **Y** la ocurrencia sigue sin resolver

### Requirement: Ranking de candidatas
Cuando una transacción tiene varias ocurrencias candidatas (o una ocurrencia varias transacciones candidatas), el sistema DEBE (MUST) ordenarlas por puntaje descendente —que pondera la cercanía de monto, la cercanía de fecha y la coincidencia de contraparte— y, a igual puntaje, por menor diferencia de días; DEBE (MUST) marcarlas como ambiguas cuando las dos mejores tienen el mismo puntaje.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Dos internet en la misma cuenta
- **CUANDO** "Internet casa" (199.00 BOB, vence 2026-10-20) e "Internet oficina" (199.00 BOB, vence 2026-10-22) están sin resolver en "Banco BOB" y se registra un gasto de 199.00 BOB el 2026-10-20
- **ENTONCES** la primera sugerencia es "Internet casa" y la segunda "Internet oficina", sin marca de ambigüedad

#### Scenario: Empate marcado como ambiguo
- **CUANDO** el mismo gasto de 199.00 BOB se registra el 2026-10-21
- **ENTONCES** ambas sugerencias tienen el mismo puntaje y quedan marcadas como ambiguas

### Requirement: Expiración de sugerencias
Una sugerencia propuesta DEBE (MUST) expirar, con su motivo, cuando la transacción se anula, cuando la ocurrencia se resuelve o cancela por cualquier vía, o cuando una edición de la transacción la deja fuera de los criterios de compatibilidad; una edición que mantiene la compatibilidad DEBE (MUST) recalcular su puntaje.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Transacción anulada expira la sugerencia
- **CUANDO** el usuario anula el gasto de 199.00 BOB del 2026-10-19 con una sugerencia propuesta para el "Internet"
- **ENTONCES** la sugerencia queda expirada por anulación y no aparece en las coincidencias por revisar

#### Scenario: Monto editado fuera de tolerancia
- **CUANDO** el usuario corrige el gasto de 199.00 BOB del 2026-10-19 a 250.00 BOB
- **ENTONCES** la sugerencia con el "Internet" queda expirada por incompatibilidad

### Requirement: Sugerencias para ocurrencias nuevas
Cuando se generan o reinstauran ocurrencias cuya ventana de fechas ya empezó, el sistema DEBE (MUST) buscar transacciones existentes no anuladas, no vinculadas y compatibles dentro de la ventana y sugerirlas con los mismos criterios, sin repetir pares descartados.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Definición creada después del pago
- **CUANDO** el 2026-10-14 el EDITOR crea el gasto recurrente "Seguro auto" de 320.00 BOB mensual desde 2026-10-10 en "Banco BOB" y ya existe un gasto de 320.00 BOB en "Banco BOB" del 2026-10-10
- **ENTONCES** se sugiere la coincidencia entre ese gasto y la ocurrencia del 2026-10-10

#### Scenario: Ocurrencia reinstaurada al reanudar
- **CUANDO** la "Natación" de 150.00 BOB fija se reanuda el 2026-12-01, su ocurrencia del 2026-12-02 se reinstaura y ya existe un gasto de 150.00 BOB en la misma cuenta del 2026-12-01
- **ENTONCES** se sugiere la coincidencia entre ese gasto y la ocurrencia del 2026-12-02

### Requirement: Candidatas para filas de un import
El sistema DEBE (MUST) ofrecer a otros contextos una consulta sin efectos que, para filas aún no registradas (tipo, cuenta, monto, fecha y contraparte opcional), devuelva las ocurrencias candidatas con los mismos criterios y puntaje; las transacciones resultantes del import DEBEN (MUST) recibir sugerencias por el flujo normal, y una ráfaga de 1000 transacciones importadas DEBE (MUST) procesarse sin sugerencias duplicadas.
Trace: FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Vista previa de un extracto
- **CUANDO** la vista previa de un import consulta las candidatas de una fila de 199.00 BOB del 2026-10-20 en "Banco BOB"
- **ENTONCES** obtiene la ocurrencia del 2026-10-20 del "Internet" con su puntaje
- **Y** no se guarda ninguna sugerencia

#### Scenario: Lote importado
- **CUANDO** se importan 1000 transacciones, 12 de ellas compatibles con ocurrencias pendientes, y algunos hechos se entregan dos veces
- **ENTONCES** existen exactamente 12 sugerencias propuestas
