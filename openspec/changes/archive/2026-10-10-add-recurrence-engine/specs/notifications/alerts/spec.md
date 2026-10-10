# Spec Delta

## ADDED Requirements

### Requirement: Aviso de pago próximo u ocurrencia por aprobar
Cuando una ocurrencia recurrente pasa a próxima, el sistema DEBE (MUST) crear una notificación para cada OWNER y EDITOR activo del workspace —"pago próximo" en los modos creación automática y solo aviso, "ocurrencia por aprobar" en aprobación pendiente— con el nombre de la definición, la fecha de vencimiento y el enlace a la ocurrencia, una sola vez por ocurrencia y destinatario aunque el hecho se entregue varias veces; el email NO DEBE (MUST NOT) incluir el monto salvo opt-in explícito y DEBE (MUST) respetar las preferencias por tipo y canal.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-NOTIFY-006 · Priority: Must

#### Scenario: Alquiler por aprobar notificado
- **CUANDO** la ocurrencia del 2026-11-05 del "Alquiler" de 3500.00 BOB en aprobación pendiente pasa a próxima
- **ENTONCES** el OWNER y el EDITOR reciben una notificación "ocurrencia por aprobar" de "Alquiler" para el 2026-11-05 con enlace a la ocurrencia
- **Y** el email no muestra 3500.00 BOB

#### Scenario: Hecho entregado dos veces
- **CUANDO** el hecho de que la ocurrencia del 2026-11-05 pasó a próxima se entrega dos veces con identificadores de evento distintos
- **ENTONCES** cada destinatario tiene una sola notificación de esa ocurrencia
