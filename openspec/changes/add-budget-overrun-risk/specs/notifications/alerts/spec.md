## ADDED Requirements

### Requirement: Aviso de riesgo de exceder un presupuesto desactivado por omisión
Cuando una línea del plan del periodo en curso pasa por primera vez en el periodo a riesgo «probable» de exceder su tope y todavía no cruzó su umbral de 100 %, el sistema DEBE (MUST) crear una notificación de tipo riesgo de presupuesto, con la línea, el periodo, la proyección, la referencia, la fecha estimada del exceso y el enlace al plan, para cada miembro activo que haya activado el tipo; una sola vez por línea, periodo y destinatario, aunque el riesgo baje y vuelva a subir o la evaluación se repita. A diferencia de los demás tipos, el tipo riesgo de presupuesto DEBE (MUST) estar desactivado por omisión en los dos canales y DEBE (MUST) respetar las preferencias por tipo y canal y el horario de silencio. El riesgo «posible» NO DEBE (MUST NOT) notificarse.
Trace: FR-REPORTING-020, FR-NOTIFY-004, FR-NOTIFY-003, FR-NOTIFY-005 · Priority: Should

#### Scenario: Tipo activado
- **CUANDO** el OWNER activó el tipo riesgo de presupuesto in-app, el EDITOR no, y el 2026-11-10 "Restaurantes" pasa a riesgo «probable» con exceso estimado el 2026-11-22
- **ENTONCES** el OWNER recibe una notificación de riesgo de "Restaurantes" en 2026-11 con proyección 840.00 de 600.00 BOB y fecha 22/11/2026
- **Y** el EDITOR no la recibe

#### Scenario: Riesgo que baja y vuelve a subir
- **CUANDO** al día siguiente un reembolso deja a "Restaurantes" en riesgo «improbable» y dos días después vuelve a «probable»
- **ENTONCES** no se crea una notificación nueva de "Restaurantes" en 2026-11

#### Scenario: Umbral de 100 % ya cruzado
- **CUANDO** "Restaurantes" ya cruzó su umbral de 100 % en 2026-11
- **ENTONCES** no se crea notificación de riesgo de presupuesto para esa línea en ese periodo

### Requirement: Emails de riesgo de presupuesto sin montos salvo opt-in
Los emails de riesgo de presupuesto NO DEBEN (MUST NOT) incluir montos ni nombres de categorías o grupos, salvo que el destinatario haya activado la inclusión de detalles; sin opt-in DEBEN (MUST) incluir solo el periodo, la fecha estimada del exceso y el enlace a la app autenticada. Los textos in-app y de email DEBEN (MUST) existir en español, inglés y portugués según el locale del destinatario, con español como respaldo.
Trace: FR-NOTIFY-006, FR-NOTIFY-002, NFR-COMP-001, NFR-USAB-001 · Priority: Must

#### Scenario: Email sin opt-in
- **CUANDO** el OWNER activó el email del tipo riesgo de presupuesto sin opt-in de detalles y "Restaurantes" pasa a riesgo «probable» con proyección 840.00 BOB
- **ENTONCES** el email indica un presupuesto en riesgo en 2026-11 con exceso estimado el 22/11/2026 y el enlace al plan
- **Y** no contiene 840.00, 600.00 ni "Restaurantes"

#### Scenario: Notificación en portugués
- **CUANDO** el OWNER tiene locale "pt-BR" y recibe el riesgo de "Restaurantes"
- **ENTONCES** la notificación y el email están en portugués con la fecha 22/11/2026
