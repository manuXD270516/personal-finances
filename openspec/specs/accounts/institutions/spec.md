# accounts/institutions Specification

## Purpose
Permite al usuario mantener su propio catálogo de instituciones financieras (bancos, fintechs, exchanges, brokers, proveedores de billeteras), configurable por workspace y nunca predefinido en el código, para agrupar y describir sus cuentas.

## Requirements

### Requirement: Alta de institución configurable
El usuario DEBE (MUST) poder crear instituciones en su workspace con nombre, tipo (`bank`, `fintech`, `exchange`, `broker`, `wallet_provider`, `other`), país opcional (código ISO de 2 letras), icono, color, sitio web y notas.
Trace: FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Crear un exchange
- **CUANDO** un usuario EDITOR crea la institución "P2P Exchange Demo" de tipo `exchange` con país "BO"
- **ENTONCES** la institución queda activa en el workspace y disponible para asociarla a cuentas

#### Scenario: País inválido
- **CUANDO** un usuario crea una institución con país "Bolivia"
- **ENTONCES** se rechaza con `VALIDATION_FAILED`

### Requirement: Instituciones no predefinidas en el producto
Ninguna institución DEBE (MUST) estar fija en el código del producto: un workspace nuevo DEBE (MUST) empezar sin instituciones salvo que se cargue un catálogo inicial opcional, y cada institución de ese catálogo DEBE (MUST) ser editable y archivable como cualquier otra.
Trace: FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Workspace nuevo
- **CUANDO** se crea un workspace sin catálogo inicial
- **ENTONCES** el listado de instituciones está vacío

#### Scenario: Institución del catálogo inicial editable
- **CUANDO** el workspace se creó con un catálogo inicial que incluye "Banco Andino Demo" y el usuario la renombra a "Banco Andino"
- **ENTONCES** la institución se llama "Banco Andino" en ese workspace y otros workspaces no se ven afectados

### Requirement: Edición de institución
El usuario DEBE (MUST) poder editar los datos de una institución; la edición NO DEBE (MUST NOT) alterar las cuentas asociadas ni sus saldos y DEBE (MUST) quedar auditada con las diferencias antes/después.
Trace: FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Cambiar el sitio web
- **CUANDO** "Bank A" (saldo 1000.00 BOB) está asociada a "Banco Andino Demo" y el usuario cambia el sitio web de la institución
- **ENTONCES** "Bank A" sigue asociada a la institución con saldo 1000.00 BOB
- **Y** existe un registro de auditoría con el sitio web anterior y el nuevo

### Requirement: Las instituciones se archivan, no se eliminan
Una institución NO DEBE (MUST NOT) eliminarse físicamente, en particular si alguna cuenta la referencia; el usuario DEBE (MUST) poder archivarla, y entonces deja de aparecer en el listado por defecto mientras sus cuentas conservan la asociación.
Trace: FR-ACCOUNTS-013 · Priority: Must

#### Scenario: Archivar una institución con cuentas
- **CUANDO** "Banco Andino Demo" está asociada a "Bank A" (saldo 1000.00 BOB) y el usuario la archiva
- **ENTONCES** la institución no aparece en el listado por defecto de instituciones
- **Y** "Bank A" sigue mostrando "Banco Andino Demo" con saldo 1000.00 BOB

### Requirement: Institución archivada no asignable
Una institución archivada NO DEBE (MUST NOT) poder asociarse a cuentas nuevas ni a cuentas existentes que no la tuvieran.
Trace: FR-ACCOUNTS-013 · Priority: Should

#### Scenario: Asociar una institución archivada
- **CUANDO** "Banco Viejo" está archivada y el usuario crea una cuenta asociada a ella
- **ENTONCES** se rechaza con `INSTITUTION_ARCHIVED`

### Requirement: Nombre único de institución activa
El nombre de una institución DEBE (MUST) ser único, sin distinguir mayúsculas, entre las instituciones no archivadas del workspace.
Trace: FR-ACCOUNTS-012 · Priority: Should

#### Scenario: Nombre repetido
- **CUANDO** existe "Banco Andino Demo" activa y el usuario crea "BANCO ANDINO DEMO"
- **ENTONCES** se rechaza con `NAME_TAKEN`
