# Spec Delta

## ADDED Requirements

### Requirement: Notificación de renovación próxima de una suscripción
Por cada hecho de renovación próxima de una suscripción publicado por Commitments, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo renovación de suscripción para cada miembro activo del workspace que no la haya desactivado, con el provider, el plan, la fecha de renovación, el precio vigente y la cuenta de pago, y con enlace a la suscripción; si la suscripción ya no existe o fue cancelada al abrirla, el enlace DEBE (MUST) llevar al listado de suscripciones indicando que ya no está disponible.
Trace: FR-NOTIFY-004, FR-NOTIFY-001, FR-COMMITMENTS-016 · Priority: Should

#### Scenario: Renovación de Streamly
- **CUANDO** el workspace tiene un OWNER, un EDITOR y un VIEWER activos y se publica la renovación próxima de "Streamly" para el 2026-11-15 por 10.99 USD con "Visa USD"
- **ENTONCES** cada uno tiene una notificación no leída de renovación de "Streamly" el 2026-11-15 por 10.99 USD con "Visa USD"

#### Scenario: Hecho reentregado
- **CUANDO** el mismo hecho de renovación de "Streamly" para el 2026-11-15 llega dos veces, con el mismo o con otro identificador de evento
- **ENTONCES** cada miembro tiene una sola notificación de esa renovación

### Requirement: Notificación de fin de trial próximo
Por cada hecho de fin de trial próximo publicado por Commitments, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo fin de trial para cada miembro activo del workspace que no la haya desactivado, con el provider, la fecha de fin de trial y el precio del primer cobro, y con enlace a la suscripción.
Trace: FR-NOTIFY-004, FR-NOTIFY-001, FR-COMMITMENTS-016 · Priority: Should

#### Scenario: Trial de CloudDrive
- **CUANDO** se publica el fin de trial próximo de "CloudDrive" para el 2026-11-20 con primer cobro de 99.99 USD
- **ENTONCES** el OWNER tiene una notificación no leída "El trial de CloudDrive termina el 20/11/2026; primer cobro 99.99 USD"

### Requirement: Notificación de posible cambio de precio de una suscripción
Por cada hecho de cambio de precio de suscripción con origen detectado, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo cambio de precio de suscripción para cada OWNER y EDITOR activo que no la haya desactivado, con el provider, el precio anterior, el observado, la variación y un enlace a la propuesta para aceptarla o rechazarla; los hechos con origen manual NO DEBEN (MUST NOT) generar notificación. La deduplicación DEBE (MUST) ser por suscripción y fecha de vigencia.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-COMMITMENTS-014 · Priority: Should

#### Scenario: Aumento detectado de MusicBox
- **CUANDO** se publica el cambio de precio detectado de "MusicBox" de 9.99 USD a 11.99 USD desde 2026-11-05 con variación "+20.02"
- **ENTONCES** el OWNER y el EDITOR tienen una notificación no leída de posible cambio de precio de "MusicBox" de 9.99 a 11.99 USD (+20.02 %) con enlace a la propuesta
- **Y** el VIEWER no recibe esa notificación

#### Scenario: Cambio registrado a mano
- **CUANDO** se publica el cambio de precio manual de "Streamly" de 10.99 USD a 12.99 USD
- **ENTONCES** no se crea ninguna notificación

### Requirement: Emails de suscripciones sin detalles salvo opt-in
Los emails de los tipos renovación de suscripción, fin de trial y cambio de precio de suscripción NO DEBEN (MUST NOT) incluir montos, monedas, nombres de provider, plan ni cuenta de pago, salvo que el destinatario haya activado la inclusión de detalles en sus preferencias; el contenido in-app no cambia por esta opción.
Trace: FR-NOTIFY-006, NFR-COMP-001 · Priority: Must

#### Scenario: Email de renovación sin detalles
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe la renovación de "Streamly" del 2026-11-15 por 10.99 USD con "Visa USD"
- **ENTONCES** el email dice que una de sus suscripciones se renueva en 3 días
- **Y** no contiene "Streamly", "10.99", "USD" ni "Visa USD"

#### Scenario: Email de renovación con detalles por opt-in
- **CUANDO** el OWNER activó la inclusión de detalles en el email
- **ENTONCES** el email indica "Streamly", el 15/11/2026 y 10.99 USD

### Requirement: Idioma de las notificaciones de suscripciones
Los textos in-app y de email de los tipos renovación de suscripción, fin de trial y cambio de precio de suscripción DEBEN (MUST) existir en español, inglés y portugués, con el idioma del locale del destinatario, español como respaldo y montos y fechas en el formato de ese locale.
Trace: NFR-USAB-001, NFR-USAB-002, FR-NOTIFY-002 · Priority: Must

#### Scenario: Renovación en inglés
- **CUANDO** el OWNER tiene locale "en-US" y recibe la renovación de "Streamly" sin opt-in de detalles
- **ENTONCES** el asunto del email es "You have an upcoming subscription renewal"

#### Scenario: Cambio de precio en portugués
- **CUANDO** el EDITOR tiene locale "pt-BR" y recibe el cambio de precio detectado de "MusicBox"
- **ENTONCES** el asunto del email es "Detectamos uma possível mudança de preço"
