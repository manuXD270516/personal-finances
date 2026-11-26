## ADDED Requirements

### Requirement: WebKit dentro del job de E2E sin un check obligatorio nuevo
El subconjunto de specs en WebKit DEBE (MUST) correr dentro del mismo job de E2E del pull request que la suite en Chromium, de modo que un fallo en WebKit haga fallar ese job. El change NO DEBE (MUST NOT) agregar un check obligatorio nuevo ni cambiar la protección de la rama principal sin una decisión del owner. El job DEBE (MUST) terminar dentro de su límite de tiempo y DEBE (MUST) publicar la duración de cada navegador en su resumen.
Trace: NFR-USAB-005, NFR-MAINT-007 · Priority: Should

#### Scenario: Un fallo en WebKit hace fallar el job existente
- **CUANDO** un spec del subconjunto falla solo en WebKit en un pull request
- **ENTONCES** falla el job de E2E existente
- **Y** la lista de checks obligatorios de la rama principal es la misma que antes del change

#### Scenario: Duración publicada y dentro del límite
- **CUANDO** termina el job de E2E de un pull request
- **ENTONCES** su resumen muestra la duración de la suite en Chromium y la del subconjunto en WebKit
- **Y** el job termina dentro de su límite de 40 minutos
