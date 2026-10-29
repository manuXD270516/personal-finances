## ADDED Requirements

### Requirement: Conexiones con proveedores en el export sin credenciales
El export DEBE (MUST) incluir las conexiones con proveedores (proveedor, nombre, mapeo de activos a cuentas, estado y cursor) y NO DEBE (MUST NOT) incluir sus credenciales ni las claves de datos envueltas; al importarlo, cada conexión DEBE (MUST) quedar en estado "requiere credencial" y no sincronizar hasta que el OWNER cargue una credencial nueva, que se verifica como al crear la conexión.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, NFR-COMP-008 · Priority: Must

#### Scenario: Ida y vuelta de una conexión de exchange
- **CUANDO** "W1" tiene la conexión activa "Exchange principal" con dos mapeos y 37 transacciones importadas, y el OWNER lo exporta e importa
- **ENTONCES** el archivo del export no contiene el secreto ni la clave de datos envuelta
- **Y** el workspace nuevo tiene "Exchange principal" con sus dos mapeos en estado "requiere credencial" y las 37 transacciones
- **Y** una sincronización antes de cargar la credencial falla con `INVALID_STATUS_TRANSITION`
