## ADDED Requirements

### Requirement: Los procesos del worker resuelven los ajustes del workspace sin usuario
Los consumidores de eventos y los jobs del worker DEBEN (MUST) obtener la moneda base y la zona horaria de un workspace, también cuando valoran cuentas en una moneda distinta de la base, por el rol de directorio de workspaces y sin exigir el usuario en el contexto de la transacción. NO DEBEN (MUST NOT) fallar con el error explícito de contexto de usuario ausente por ese motivo, y la política de lectura de workspaces por membresía NO DEBE (MUST NOT) relajarse para el rol del worker. Un actor de usuario DEBE (MUST) seguir leyendo por la membresía de la petición.
Trace: NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Eventos y job de tarjetas sobre el dataset Demo v2
- **CUANDO** el worker procesa los eventos de la carga del dataset Demo v2 (tarjetas en USD con moneda base BOB) y se ejecuta el job diario de tarjetas
- **ENTONCES** el consumidor de actividad de tarjetas vacía su cola sin ninguna entrega fallida por contexto de usuario ausente
- **Y** el job diario de tarjetas termina sin fallos por tarjeta
