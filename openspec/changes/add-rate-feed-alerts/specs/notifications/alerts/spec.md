## ADDED Requirements

### Requirement: Notificación de par sin tasa fresca
Por cada hecho de obsolescencia de un par, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo tasa obsoleta, de severidad advertencia, para cada OWNER y EDITOR activo del workspace que no la haya desactivado, con el par, el instante de la última tasa automática y las horas transcurridas, y con enlace al estado de las tasas automáticas; la deduplicación DEBE (MUST) ser por par y episodio, y un VIEWER NO DEBE (MUST NOT) recibirla.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-FX-010 · Priority: Must

#### Scenario: USDT/BOB sin tasa fresca
- **CUANDO** se publica la obsolescencia de USDT/BOB en "W1" con última tasa automática del 2026-10-13T08:00:00Z, verificada a las 2026-10-13T14:15:00Z
- **ENTONCES** el OWNER y el EDITOR tienen una notificación no leída "USDT/BOB lleva más de 6 horas sin tasa automática" con enlace al estado de las tasas automáticas
- **Y** el VIEWER no la recibe

#### Scenario: Hecho reentregado
- **CUANDO** el mismo hecho de obsolescencia se procesa dos veces
- **ENTONCES** cada destinatario tiene una sola notificación de ese episodio

### Requirement: Notificación de recuperación de un par
Por cada hecho de recuperación de un par, el sistema DEBE (MUST) crear una sola notificación in-app de tipo tasa recuperada, de severidad informativa, para cada OWNER y EDITOR activo que no la haya desactivado, con el par y la vigencia de la nueva tasa, una sola vez por par y episodio.
Trace: FR-NOTIFY-004, FR-NOTIFY-005 · Priority: Should

#### Scenario: USDT/BOB recuperado
- **CUANDO** se publica la recuperación de USDT/BOB en "W1" con nueva vigencia 2026-10-13T15:58:00Z
- **ENTONCES** el OWNER y el EDITOR tienen una notificación "USDT/BOB volvió a tener tasa automática" con enlace al estado de las tasas automáticas

### Requirement: Notificación de muestra anómala retenida
Por cada hecho de muestra retenida como anómala, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo tasa anómala retenida, de severidad advertencia, para cada OWNER y EDITOR activo que no la haya desactivado, con el par, el provider, el valor, la línea base y la variación, y con enlace a la revisión de esa tasa donde se confirma o se rechaza; la deduplicación DEBE (MUST) ser por tasa.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-FX-010 · Priority: Should

#### Scenario: Bitcoin retenido
- **CUANDO** se publica la muestra retenida de BTC/USDT 72000.00 con línea base 65000.00 y variación +10.77 %
- **ENTONCES** el OWNER y el EDITOR tienen una notificación no leída de tasa anómala retenida de BTC/USDT con enlace a su revisión
- **Y** al abrirla pueden confirmarla o rechazarla con un motivo

### Requirement: Emails de tasas sin valores salvo opt-in
Los emails de los tipos tasa obsoleta, tasa recuperada y tasa anómala retenida NO DEBEN (MUST NOT) incluir valores de tasa, variaciones, códigos de moneda ni nombres de providers, salvo que el destinatario haya activado la inclusión de detalles en sus preferencias; DEBEN (MUST) enlazar a la app autenticada y respetar las preferencias por tipo y canal y el horario de silencio.
Trace: FR-NOTIFY-006, NFR-COMP-001 · Priority: Must

#### Scenario: Email de anomalía sin detalles
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe la tasa anómala retenida de BTC/USDT 72000.00
- **ENTONCES** el email dice que una tasa automática quedó retenida y necesita su revisión, con enlace a la app
- **Y** no contiene "72000.00", "65000.00", "10.77", "BTC" ni "USDT"

#### Scenario: Email de obsolescencia desactivado
- **CUANDO** el EDITOR desactivó el email del tipo tasa obsoleta
- **ENTONCES** recibe la notificación in-app y no se le envía ningún email de ese episodio

### Requirement: Idioma de las notificaciones de tasas
Los textos in-app y de email de los tipos tasa obsoleta, tasa recuperada y tasa anómala retenida DEBEN (MUST) existir en español, inglés y portugués, con el idioma del locale del destinatario, español como respaldo y valores, porcentajes, fechas y horas en el formato de ese locale y en la zona del workspace.
Trace: NFR-USAB-001, NFR-USAB-002, FR-NOTIFY-002 · Priority: Must

#### Scenario: Obsolescencia en portugués
- **CUANDO** el EDITOR tiene locale "pt-BR" y recibe la obsolescencia de USDT/BOB con última tasa del 2026-10-13T08:00:00Z en un workspace de America/La_Paz
- **ENTONCES** el texto está en portugués y muestra la hora 04:00 del 13/10/2026
