## ADDED Requirements

### Requirement: Aviso de gastos atípicos desactivado por omisión
Cuando una pasada del trabajo diario marca gastos atípicos nuevos en un workspace, el sistema DEBE (MUST) crear una sola notificación de tipo gasto atípico por destinatario y por pasada, con la cantidad de gastos atípicos nuevos, el motivo del más alto en la moneda de reporte y el enlace a la lista, para cada OWNER y EDITOR activo que haya activado el tipo. A diferencia de los demás tipos, el tipo gasto atípico DEBE (MUST) estar desactivado por omisión en los dos canales; DEBE (MUST) respetar las preferencias por tipo y canal y el horario de silencio, y repetir la pasada NO DEBE (MUST NOT) duplicar la notificación.
Trace: FR-FORECAST-010, FR-NOTIFY-004, FR-NOTIFY-003, FR-NOTIFY-005 · Priority: Should

#### Scenario: Sin activar el tipo
- **CUANDO** el OWNER no cambió sus preferencias y la pasada del 2026-11-13 marca dos gastos atípicos nuevos
- **ENTONCES** el OWNER no recibe ninguna notificación y los dos gastos figuran en la lista

#### Scenario: Tipo activado
- **CUANDO** el OWNER y el EDITOR activaron el tipo gasto atípico in-app, el VIEWER también, y la pasada del 2026-11-13 marca dos gastos atípicos nuevos
- **ENTONCES** el OWNER y el EDITOR reciben una sola notificación cada uno con 2 gastos atípicos nuevos y el enlace a la lista
- **Y** el VIEWER no la recibe

#### Scenario: Pasada repetida
- **CUANDO** el trabajo diario del 2026-11-13 corre dos veces
- **ENTONCES** cada destinatario tiene una sola notificación de esa pasada

### Requirement: Emails de gastos atípicos sin montos salvo opt-in
Los emails de gasto atípico NO DEBEN (MUST NOT) incluir montos, categorías, contrapartes ni descripciones, salvo que el destinatario haya activado la inclusión de detalles; sin opt-in DEBEN (MUST) incluir solo la cantidad de gastos atípicos nuevos, la fecha de la pasada y el enlace a la app autenticada. Los textos in-app y de email DEBEN (MUST) existir en español, inglés y portugués según el locale del destinatario, con español como respaldo.
Trace: FR-NOTIFY-006, FR-NOTIFY-002, NFR-COMP-001, NFR-USAB-001 · Priority: Must

#### Scenario: Email sin opt-in
- **CUANDO** el OWNER activó el email del tipo gasto atípico sin opt-in de detalles y la pasada del 2026-11-13 marca un gasto de 304.00 BOB en "Restaurantes"
- **ENTONCES** el email indica 1 gasto atípico nuevo el 13/11/2026 con el enlace a la lista
- **Y** no contiene 304.00, "Restaurantes" ni el nombre de la contraparte

#### Scenario: Email en inglés con opt-in
- **CUANDO** el EDITOR tiene locale "en-US", activó el email del tipo y la inclusión de detalles
- **ENTONCES** el email está en inglés y muestra el monto y el motivo con el formato de ese locale
