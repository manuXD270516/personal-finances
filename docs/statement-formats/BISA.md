# Ficha de formato: Banco BISA

> **Estado:** Registrado · **Fecha:** 2026-10-16 · **Muestra:** una cuenta en dólares (producto de ahorro digital), 1 página, **periodo sin actividad**. Sin datos reales en esta ficha; fixture sintético en `tests/fixtures/imports/statements-bo/bisa` (institución ficticia "Banco Sierra Demo").

## Origen y extracción

- **Generador:** iText ("Estado de Cuenta").
- **Texto extraíble:** sí. `pdftotext -layout` conserva los bloques de cabecera, resumen y totales.
- **Limitación importante de la muestra:** como el periodo no tuvo movimientos, **la disposición de las filas de la tabla no se observó**. Solo se conocen los encabezados de columna. No se inventó ninguna fila: el fixture cubre solo el caso sin actividad, y el formato de las filas queda pendiente de una muestra con movimientos.

## Encabezado

| Campo | Ejemplo sintético | Formato | Uso |
|---|---|---|---|
| Página | `Página: 1 de 1` | texto | control de páginas |
| Titular y agencia | (nombre y código) | texto | descartar |
| Periodo del estado | `Marzo 2026` | mes en **texto español** y año | `periodFrom`/`periodTo` |
| Saldos: fecha, final, disponible | `31-03-2026`, `250,75`, `250,75` | `DD-MM-AAAA`; coma decimal | `closingBalance` (final) |
| Saldo Prom / Monto Ret / *TEP | `250,75` / `0,00` / `0,00` | coma decimal | informativo |
| Nro. Cuenta | `0000000001` | dígitos | casar con la cuenta destino |
| Producto | `000-Cuenta Demo NEO` | código-nombre | informativo |
| Moneda | `M/E`, `$US` | marcador de moneda extranjera y símbolo | **moneda USD**: validar contra la cuenta |
| Situación | `ACTIVA` | texto | informativo |

## Resumen del periodo

Fila de seis valores: **Saldo Inicial**, **Depósitos / Créditos**, **Retiros / Débitos**, **Cargos por Servicios**, **Interés Pagado**, **Interés Cobrado**. **Decimal con coma** (`250,75`). El separador de miles no se observó (los saldos de la muestra eran pequeños).

## Tabla de movimientos (solo encabezados observados)

Columnas: **Fecha** (`DD-MM-AAAA`), **Sucursal**, **Hora**, **Comprobante / N° Cheque**, **C/T**, **Descripción**, **Débitos**, **Créditos**, **Saldos**. Sin actividad la tabla se reduce a una línea `000 Sin Actividad en el Periodo`.

Mapeo previsto a docs/13: Fecha → fecha de negocio; Descripción → descripción; Débitos/Créditos → monto con signo (`crédito - débito`); Saldos → saldo corrido; Comprobante/N° Cheque → referencia/`external id`; Sucursal, C/T → metadatos. **Previsto, no verificado.**

## Totales (pie)

`Total Operaciones`, `Total Operaciones sujetas a ITF`, `Monto sujeto a ITF`, `Total ITF`, `Total Débitos`, `Total Créditos`, `Saldo Actual`. **Rareza observada:** `Total Operaciones` valía 1 aunque no hubo actividad (cuenta la línea "Sin Actividad"); no usarlo como número de movimientos.

## Casos especiales

- **Sin actividad:** `Sin Actividad en el Periodo`; saldo inicial = final = saldo actual, y todos los totales y el resumen en cero.
- **Interés pagado / cobrado, cargos por servicios e ITF:** tienen su propia columna en el resumen y en los totales. En el periodo con movimientos pueden aparecer como filas de la tabla o solo como totales; no se observó.
- **Aviso final:** texto sobre acreditación de cheques de otro banco o plaza; descartar.

## Riesgos de parseo

1. **Coma decimal** (`250,75`): reemplazar por punto antes de crear el `Decimal`; si hay miles, probablemente con punto (no observado): el perfil debe declararlo y fallar si encuentra ambos sin declaración.
2. Moneda USD: el `Money` debe usar la escala de USD; el perfil de mapeo no puede asumir BOB.
3. Mes en texto español y fecha `DD-MM-AAAA` (con guiones, distinta de las otras tres entidades).
4. Formato de filas **no observado**: el parser no debe escribirse sin una muestra con actividad.
5. `Total Operaciones` no es fiable.

## Verificaciones de coherencia

- `Saldo Inicial + Depósitos + Interés Pagado - Retiros - Cargos - Interés Cobrado = Saldo Final` (fórmula prevista; con la muestra solo se verificó el caso en cero).
- `Total Débitos` y `Total Créditos` = suma de la tabla; `Saldo Actual` = saldo final del encabezado.

## Valor recomendado de `statementImport`

**`PENDING_SAMPLE`.** El PDF es texto (no `IMAGE_ONLY_STATEMENT`), pero la muestra no trae movimientos y no hay evidencia de CSV/XLS: no se puede declarar `GENERIC_ONLY` ni describir las filas. Se necesita otra muestra con actividad (idealmente con un depósito, un retiro, un interés y un cargo) antes de planear un perfil.
