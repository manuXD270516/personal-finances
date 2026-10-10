## ADDED Requirements

### Requirement: Notificación de vencimiento de tarjeta
Cuando se publica el recordatorio de vencimiento de un estado de cuenta, el sistema DEBE (MUST) crear una notificación de tipo vencimiento de tarjeta para cada OWNER y EDITOR activo del workspace con el nombre de la tarjeta, la moneda, la fecha de vencimiento y el enlace al estado de cuenta, una sola vez por cuenta de la tarjeta, fecha de cierre y destinatario aunque el hecho se entregue varias veces; el email NO DEBE (MUST NOT) incluir montos ni el nombre de la tarjeta salvo opt-in explícito y DEBE (MUST) respetar las preferencias por tipo y canal.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-NOTIFY-006, FR-DEBT-013 · Priority: Must

#### Scenario: Vencimiento de Visa Oro notificado
- **CUANDO** se publica el recordatorio del estado de cuenta de "Visa Oro BOB" que vence el 2026-11-15 con 1120.50 BOB para no generar intereses
- **ENTONCES** el OWNER y el EDITOR reciben una notificación de vencimiento de "Visa Oro" (BOB) para el 2026-11-15 con enlace al estado de cuenta
- **Y** el VIEWER no la recibe y el email sin opt-in no muestra 1120.50 BOB ni "Visa Oro"

#### Scenario: Recordatorio entregado dos veces
- **CUANDO** el recordatorio del estado de cuenta cerrado el 2026-10-25 se entrega dos veces con identificadores de evento distintos
- **ENTONCES** cada destinatario tiene una sola notificación de vencimiento de ese estado de cuenta

### Requirement: Notificación de utilización de la tarjeta
Cuando se publica que una tarjeta alcanzó un umbral de utilización, el sistema DEBE (MUST) crear una notificación de severidad advertencia para cada OWNER y EDITOR activo con el nombre de la tarjeta, el umbral más alto alcanzado y la utilización, una sola vez por tarjeta, umbral y cruce; el email NO DEBE (MUST NOT) incluir montos ni la utilización salvo opt-in explícito.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-NOTIFY-006, FR-DEBT-015 · Priority: Should

#### Scenario: Visa Oro al 85 %
- **CUANDO** se publica que "Visa Oro USD" alcanzó el umbral 80.00 % (también el 30.00 %) con utilización 85.00 %
- **ENTONCES** el OWNER y el EDITOR reciben una sola notificación "Visa Oro alcanzó el 80 % de su límite" con enlace a la tarjeta

### Requirement: Sin doble aviso del pago de tarjeta
Para las ocurrencias de pago de tarjeta que no requieren aprobación, el sistema NO DEBE (MUST NOT) crear la notificación genérica de "pago próximo", porque el vencimiento lo avisa la notificación de vencimiento de tarjeta; para las que requieren aprobación DEBE (MUST) mantener la notificación "ocurrencia por aprobar".
Trace: FR-NOTIFY-004, FR-NOTIFY-005 · Priority: Must

#### Scenario: Plan en modo solo aviso
- **CUANDO** la ocurrencia del 2026-11-15 del pago de "Visa Oro BOB" en modo solo aviso pasa a próxima
- **ENTONCES** no se crea la notificación genérica de pago próximo

#### Scenario: Plan con aprobación pendiente
- **CUANDO** la ocurrencia del 2026-11-15 del pago de "Visa Oro BOB" en aprobación pendiente pasa a próxima
- **ENTONCES** el OWNER y el EDITOR reciben la notificación "ocurrencia por aprobar" del pago de "Visa Oro"

### Requirement: Idioma de las notificaciones de tarjeta
Las notificaciones de vencimiento y de utilización de tarjeta DEBEN (MUST) generarse en el idioma del destinatario (español, inglés o portugués, con español por defecto) y formatear fechas y porcentajes según ese idioma.
Trace: FR-NOTIFY-002, FR-NOTIFY-004 · Priority: Should

#### Scenario: Destinatario en inglés
- **CUANDO** el EDITOR usa el idioma inglés y recibe la notificación de vencimiento de "Visa Oro" para el 2026-11-15
- **ENTONCES** el texto de la notificación está en inglés con la fecha en formato de ese idioma
