# Ficha de formato: Banco Ganadero

> **Estado:** Registrado · **Fecha:** 2026-10-16 · **Muestra:** una cuenta en bolivianos, 6 páginas. Sin datos reales en esta ficha; fixture sintético en `tests/fixtures/imports/statements-bo/ganadero` (institución ficticia "Banco Pampa Demo", 2 páginas).

## Origen y extracción

- **Generador:** jsPDF (extracto de la banca por internet).
- **Texto extraíble:** sí. `pdftotext -layout` conserva las columnas, incluidos los montos de Débito y Crédito. Límites: la descripción se parte en 2 a 4 líneas y se corta en el salto de página.

## Encabezado (primera página)

| Campo | Ejemplo sintético | Formato | Uso |
|---|---|---|---|
| Título y rango | `01/03/2026-31/03/2026` | `DD/MM/AAAA-DD/MM/AAAA` | periodo |
| Moneda | `EXPRESADO EN BOLIVIANOS` | texto | moneda de la cuenta |
| NRO. DE CUENTA | `0000000001` | dígitos | casar con la cuenta destino |
| Rango | `DEL 01/03/2026 AL 31/03/2026` | `DD/MM/AAAA` | `periodFrom`/`periodTo` |
| CLIENTE | (titular) | texto | descartar |
| Procesado por | (id del operador) | dígitos | descartar (dato personal) |
| Fecha / Hora de proceso | `02/04/2026`, `10:00:00 Hs.` | `DD/MM/AAAA`, `HH:MM:SS Hs.` | informativo |

El encabezado **no trae saldo final**: el saldo inicial es la fila "Saldo anterior" y el final está en el pie de la última página.

## Tabla de movimientos (se repite en cada página)

Columnas: **FECHA** (`DD/MM/AAAA`), **HORA** (`HH:MM:SS`), **OFICINA/CANAL** (`WEB/MOV/...`, `ATM/POS`, nombre de oficina), **TRANSACCIÓN** (id numérico), **DESCRIPCIÓN** (2 a 4 líneas), **DÉBITO**, **CRÉDITO** (`0.00` en la que no aplica) y **SALDO** corrido. Miles con coma y decimal con punto (`10,500.75`).

- Primera fila: `Saldo anterior` con `-` en fecha, hora, canal e id, y el saldo inicial en SALDO. No es un movimiento.
- **Monto con signo:** `crédito - débito` (nunca ambos distintos de cero en la muestra).
- **Referencia:** TRANSACCIÓN como `external id`, **con cautela**: un interés y su retención de impuesto pueden compartir id. Usar `RowFingerprint` además del id.
- **Contraparte:** va en texto libre dentro de la descripción (`TRANSF. QR ACH Nro. <n> <BANCO> <cuenta> <nombre> <glosa>`, `Transferencia de <cuenta>. <nombre> <glosa>`, `Transferencia a <cuenta>. <nombre> <glosa>`). La glosa final puede ser `Sin referencia`/`Sin informacion` o un texto del usuario.
- **Anotaciones de estado** mezcladas en la descripción de transferencias recibidas (`Aún falta <n>`, `Completado`); no son parte de la glosa del ordenante y cambian entre las dos mitades de un pago en cuotas.

## Pie

Al final de cada página: `Página Actual: N` y `Total Páginas: M`. En la última página, los totales `TOTAL SALDO ACTUAL`, `TOTAL FONDOS RESERVADOS`, `SALDO DISPONIBLE` y `DEPOSITO POR CONFIRMAR`; `TOTAL SALDO ACTUAL` es el saldo final.

## Casos especiales

- **Interés ganado y retención de impuestos (IVA):** filas de canal `oficina` con id propio, hora temprana y **listadas al final del día** aunque su hora sea anterior a la de filas previas (**no cronológico**). El saldo corrido sigue el orden impreso.
- **Depósito ATM:** id corto distinto del resto.
- **Sin actividad / ITF / cargos:** no observados en la muestra.
- **Fondos reservados y depósitos por confirmar:** son retenciones fuera del saldo corrido; no son movimientos.

## Riesgos de parseo

1. **Corte en el salto de página:** una descripción puede empezar al final de una página y seguir, tras el encabezado repetido de la siguiente, en una línea sin fecha. Hay que descartar el encabezado y las líneas de pie, y unir la continuación con el movimiento anterior (que es el último de la página previa).
2. Filas no cronológicas al final del día: no ordenar por fecha/hora; ordenar por aparición.
3. Descripciones de 2 a 4 líneas con nombres de terceros y glosas libres.
4. Ids de 6 a 10 dígitos: no confundir con montos (el id va en su propia columna).
5. Montos con miles (`10,500.75`): retirar la coma antes de crear el `Decimal`.
6. Separar `Página Actual: N Total Páginas: M` del contenido y comprobar que se leyeron las M páginas.

## Verificaciones de coherencia

- `saldo anterior + suma(crédito - débito) = TOTAL SALDO ACTUAL`.
- Saldo corrido fila a fila en el orden impreso (incluidas las filas fuera de orden y la fila cortada entre páginas).
- Número de páginas leídas = `Total Páginas`.


## Diseño publicado (change 57, `add-pdf-statement-parser`)

- **Diseño:** `bo.ganadero.cuenta` **versión 1** (`packages/contexts/imports/src/infrastructure/pdf/layouts/bo.ganadero.cuenta.v1.json`, inmutable; un formato nuevo del banco es la versión 2). Los literales de detección son rótulos fijos de la primera página, sin el nombre del banco ni datos del titular.
- **Extracción:** por **coordenadas** con PDF.js (decisión del change, ya no hipótesis): el motor ordena los fragmentos por posición, arma las bandas de columna con los rótulos de cada página y reconstruye cada fila; el orden del flujo de contenido no cuenta.
- **Lectura:** ancla por fecha (`DD/MM/AAAA`); columnas Débito y Crédito (signo = crédito − débito; ambos distintos de cero ⇒ fila inválida `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`); la fila `Saldo anterior` aporta el saldo inicial y `TOTAL SALDO ACTUAL` del pie de la última página el final (no son movimientos); la glosa cortada por el salto de página se une al último movimiento de la página anterior; los pies `Página Actual:` y `Total Páginas:` se descartan y el total se comprueba contra las páginas leídas.
- **Fragmentos variables:** `Aún falta {n}` y `Completado` (pregunta 8, D354) se quitan SOLO de la descripción usada en la huella: volver a descargar el mismo mes da 0 transacciones nuevas aunque el banco recalcule esas anotaciones.
- **Referencia:** la columna `TRANSACCIÓN` no es única (`reference.unique = false`): no se usa como identificador externo.
- **Verificación con extractos reales:** pendiente del owner con `pnpm imports:pdf:probe <ruta-absoluta-al-pdf>` (solo imprime estructura, nunca montos ni nombres; tarea 9.1). `statementImport` sigue en `PENDING_SAMPLE` hasta entonces.

## Valor recomendado de `statementImport`

**`PENDING_SAMPLE`.** Texto extraíble (no `IMAGE_ONLY_STATEMENT`) pero sin evidencia de una exportación CSV/XLS, de modo que no es `GENERIC_ONLY`. Pasa a `GENERIC_ONLY` si el owner confirma que la banca por internet exporta CSV/XLS compatible, y a `SUPPORTED` con el parser de PDF de Phase 6/11. Es el formato con más riesgo de parseo por cortes de página y orden no cronológico.
