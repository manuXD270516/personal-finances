## ADDED Requirements

### Requirement: Aviso de meta sobre-asignada
Por cada hecho de sobre-asignación de una cuenta publicado por Goals, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo meta sobre-asignada para cada OWNER y EDITOR activo que no la haya desactivado, con la cuenta, el saldo, lo reservado, el faltante y las metas afectadas, y con enlace a las reservas de la cuenta; la deduplicación DEBE (MUST) ser por cuenta y episodio.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-GOALS-004 · Priority: Must

#### Scenario: Banco BOB sobre-asignado
- **CUANDO** se publica la sobre-asignación de "Banco BOB" con saldo 5800.00 BOB, reservado 7000.00 BOB y faltante 1200.00 BOB para "Laptop" y "Fondo de emergencia"
- **ENTONCES** el OWNER y el EDITOR tienen una notificación no leída de meta sobre-asignada de "Banco BOB" con faltante 1200.00 BOB y las dos metas
- **Y** el VIEWER no recibe esa notificación

#### Scenario: Hecho reentregado
- **CUANDO** el mismo hecho de sobre-asignación llega dos veces con identificadores de evento distintos
- **ENTONCES** cada destinatario tiene una sola notificación de ese episodio

### Requirement: Notificación de meta alcanzada
Por cada hecho de meta alcanzada, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo meta alcanzada para cada miembro activo que no la haya desactivado, con el nombre de la meta, el objetivo, el saldo acumulado y la fecha, y con enlace a la meta.
Trace: FR-NOTIFY-004, FR-GOALS-008 · Priority: Should

#### Scenario: Laptop alcanzada
- **CUANDO** se publica que "Laptop" alcanzó 9000.00 BOB de 9000.00 BOB el 2026-10-20
- **ENTONCES** el OWNER, el EDITOR y el VIEWER tienen una notificación no leída "Alcanzaste tu meta Laptop" con enlace a la meta

### Requirement: Notificación de hito de una meta
Por cada hecho de movimiento de una meta cuyo porcentaje completado pase de estar por debajo a igual o por encima de 25, 50 o 75 %, el sistema DEBE (MUST) crear una notificación in-app de tipo hito de meta para cada miembro activo que no la haya desactivado, con el hito más alto cruzado; cada hito DEBE (MUST) notificarse a lo sumo una vez por meta y destinatario aunque el porcentaje baje y vuelva a cruzarlo, y un movimiento con progreso incompleto por falta de tasa NO DEBE (MUST NOT) generar hitos.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-GOALS-008 · Priority: Should

#### Scenario: Cruce del 50 %
- **CUANDO** se publica un aporte a "Fondo de emergencia" que lleva el porcentaje de 46.67 % a 53.33 %
- **ENTONCES** cada miembro tiene una notificación de hito del 50 % de "Fondo de emergencia"

#### Scenario: Dos hitos en un solo aporte
- **CUANDO** un aporte lleva "Laptop" de 20.00 % a 55.56 %
- **ENTONCES** se crea una sola notificación con el hito del 50 %, que también informa el 25 %

#### Scenario: Hito ya notificado
- **CUANDO** "Fondo de emergencia" baja a 48.00 % por un retiro y un aporte posterior la lleva a 52.00 %
- **ENTONCES** no se crea una notificación nueva del 50 %

### Requirement: Emails de metas sin montos salvo opt-in
Los emails de los tipos meta sobre-asignada, meta alcanzada e hito de meta NO DEBEN (MUST NOT) incluir montos, monedas, nombres de metas ni de cuentas, salvo que el destinatario haya activado la inclusión de detalles en sus preferencias; el contenido in-app no cambia por esta opción.
Trace: FR-NOTIFY-006, NFR-COMP-001 · Priority: Must

#### Scenario: Email de sobre-asignación sin detalles
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe la sobre-asignación de "Banco BOB" con faltante 1200.00 BOB
- **ENTONCES** el email dice que una de sus cuentas tiene más dinero reservado para metas que su saldo
- **Y** no contiene "Banco BOB", "1200.00", "BOB", "Laptop" ni "Fondo de emergencia"

### Requirement: Idioma de las notificaciones de metas
Los textos in-app y de email de los tipos meta sobre-asignada, meta alcanzada e hito de meta DEBEN (MUST) existir en español, inglés y portugués, con el idioma del locale del destinatario, español como respaldo y montos, porcentajes y fechas en el formato de ese locale.
Trace: NFR-USAB-001, NFR-USAB-002, FR-NOTIFY-002 · Priority: Must

#### Scenario: Meta alcanzada en inglés
- **CUANDO** el OWNER tiene locale "en-US" y recibe la meta alcanzada de "Laptop" sin opt-in de detalles
- **ENTONCES** el asunto del email es "You reached one of your savings goals"
