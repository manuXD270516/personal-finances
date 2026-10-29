## ADDED Requirements

### Requirement: Origen de la clasificación de cada split
Cada split de un ingreso, gasto o reembolso DEBE (MUST) registrar el origen de su categoría (`MANUAL`, `RULE`, `COUNTERPARTY_DEFAULT` o `SYSTEM_DEFAULT` para "sin categoría") y, si es `RULE`, la regla y versión; los splits registrados antes de este cambio DEBEN (MUST) informarse con origen `UNKNOWN`. Todo cambio de categoría hecho por el usuario (formulario, edición masiva o vista previa del import) DEBE (MUST) dejar el origen en `MANUAL`, y el origen NO DEBE (MUST NOT) afectar al ledger.
Trace: FR-RULES-010, FR-CLASSIFICATION-011 · Priority: Must

#### Scenario: Orígenes de un import
- **CUANDO** un import crea un gasto de 185.40 BOB clasificado por la regla "Supermercado" v1, uno de 60.00 BOB con la categoría por defecto de la contraparte "Farmacorp" y uno de 300.00 BOB "sin categoría"
- **ENTONCES** sus splits tienen origen `RULE` (regla "Supermercado", versión 1), `COUNTERPARTY_DEFAULT` y `SYSTEM_DEFAULT`
- **Y** el saldo de la cuenta baja exactamente 545.40 BOB

#### Scenario: Edición masiva de la categoría
- **CUANDO** el usuario cambia por edición masiva la categoría del gasto de 185.40 BOB a "Hogar"
- **ENTONCES** su split queda con origen `MANUAL` sin regla

### Requirement: Marca de revisión pendiente
Una transacción DEBE (MUST) poder quedar marcada como pendiente de revisión, con el motivo (la regla y versión que la marcó, o el usuario); el listado DEBE (MUST) filtrar por esa marca y el OWNER o EDITOR DEBE (MUST) poder quitarla con control optimista y auditoría, sin efecto en el ledger ni en el estado de la transacción.
Trace: FR-RULES-005, FR-TRANSACTIONS-033 · Priority: Must

#### Scenario: Filtrar y resolver las pendientes de revisión
- **CUANDO** la regla "Revisar gastos grandes" marcó 3 gastos importados y el usuario filtra el listado por "pendientes de revisión"
- **ENTONCES** el listado muestra exactamente esos 3 gastos con el motivo "regla Revisar gastos grandes (v1)"
- **Y** al quitar la marca de uno de 2450.00 BOB el saldo de la cuenta no cambia y queda un registro de auditoría
