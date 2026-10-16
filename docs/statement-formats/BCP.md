# Ficha de formato: BCP (Banco de Crédito de Bolivia)

> **Estado:** Registrado · **Fecha:** 2026-10-16 · **Muestra:** una caja de ahorro en bolivianos, 1 página. Sin datos reales en esta ficha; fixture sintético en `tests/fixtures/imports/statements-bo/bcp` (institución ficticia "Banco Cumbre Demo").

## Origen y extracción

- **Generador:** Microsoft Reporting Services (extracto "por mes" exportado desde la banca por internet).
- **Texto extraíble:** sí. `pdftotext -layout` conserva las columnas. Límite: la descripción se parte en varias líneas dentro de su columna y hay que unirlas.
- **Tamaño de la muestra:** 1 página con pie "Página 1 de 1". Se desconoce cómo pagina un mes largo; asumir que repite el encabezado de la tabla.

## Encabezado

| Campo | Ejemplo sintético | Formato | Uso |
|---|---|---|---|
| Nro. Cuenta | `000-00000001-0-00` | guiones | casar con la cuenta destino |
| Periodo | `Marzo 2026` | mes en **texto español** y año | `periodFrom`/`periodTo` (primer y último día del mes) |
| Cliente | (nombre del titular) | texto | descartar (dato personal) |
| Moneda | `Bolivianos` | texto | moneda de la cuenta (validar contra la cuenta) |
| Saldo Inicial | `155.00` | punto decimal, sin miles | `StatementBalance.openingBalance` |
| Saldo Final | `1019.32` | ídem | `StatementBalance.closingBalance` |
| Fecha Consulta | `02/04/2026 - 10:00:00` | `DD/MM/AAAA - HH:MM:SS` | solo informativo |
| Tipo Cuenta | `Caja Ahorro` | texto | informativo |

## Tabla de movimientos

Columnas: **Fecha** (`AAAAMMDD`), **Hora** (`HH:MM:SS`), **Descripción** (1 a 4 líneas), **Medio de Atención**, **Lugar**, **Monto** (con signo; **negativo = débito**), **Saldo** (corrido). Decimal con punto y **sin separador de miles** (`1250.00`).

Mapeo a docs/13: Fecha+Hora → fecha de negocio (la hora no tiene zona; se asume America/La_Paz); Descripción → descripción limpia; Monto → `Money` con signo (ya viene firmado); Saldo → saldo corrido de control; Medio de Atención → metadato (`Tarjeta de Debito`, `Transferencia Interbancaria`, `Automático`); Lugar → metadato. **No hay referencia ni comprobante**: el `external id` no existe y el `RowFingerprint` se arma con fecha, hora, monto, saldo y descripción. En las transferencias QR la contraparte y su cuenta van dentro de la descripción multilínea, separadas por ` - `.

## Casos especiales

- **Interés ganado:** fila automática (`Interesganado`) con hora `00:00:00` y medio `Automático`, que puede aparecer primera aunque su fecha sea el primer día del periodo.
- **Sin retención ni ITF** en la muestra; no se observó columna de cargos. Un cargo vendría como un monto negativo más.
- **Sin actividad:** no observado. Esperable una tabla vacía con saldo inicial igual al final.
- **Pie:** texto "Esta información está sujeta a verificación y confirmación del Banco por lo que carece de valor legal." Descartar.

## Riesgos de parseo

1. Descripción multilínea: las líneas de continuación no traen fecha, hora ni monto; pertenecen al movimiento anterior.
2. El mes del periodo está en texto (`Marzo`); el año va aparte.
3. Sin separador de miles: un monto como `1250.00` no debe confundirse con una fecha ni con un id.
4. La fecha `AAAAMMDD` se pega a la hora en algunas extracciones: separar por posición de columna.
5. Fila de interés fuera de orden respecto de las demás por la hora `00:00:00`.

## Verificaciones de coherencia

- `saldo inicial + suma(montos) = saldo final`.
- Saldo corrido: `saldo(n) = saldo(n-1) + monto(n)` en el orden impreso.
- La moneda del encabezado coincide con la de la cuenta destino.

## Valor recomendado de `statementImport`

**`PENDING_SAMPLE`.** El PDF es texto (no `IMAGE_ONLY_STATEMENT`), pero no hay evidencia de un CSV o XLS exportable, así que no se declara `GENERIC_ONLY`. Pasaría a `GENERIC_ONLY` si el owner confirma una exportación CSV/XLS compatible, y a `SUPPORTED` con el perfil de PDF de Phase 6/11. Es el formato más simple de los cuatro: buen candidato para el primer perfil.
