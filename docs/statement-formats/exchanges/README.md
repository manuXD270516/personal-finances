# Fichas de formato de historial de exchanges

Formatos de los archivos de historial que el usuario exporta de un exchange y sube a una conexión de archivo (`imports/banking-providers`, FR-IMPORTS-014). Una ficha fija las columnas, el separador, la zona de las fechas y el formato de números **a partir de una muestra real** que el owner comparte en la conversación (D255, D341): **nunca** se versiona una exportación real; los fixtures son sintéticos y anonimizados.

Mismo patrón que las fichas de bancos de [`../`](../README.md) (change 41): sin muestra verificada el proveedor queda `formatStatus = PENDING_SAMPLE`, no se ofrece, y un archivo que no coincide con ningún formato verificado se rechaza con `IMPORT_UNSUPPORTED_FORMAT`.

| Proveedor | Reporte | `formatStatus` | Fixture sintético | Muestra real |
|---|---|---|---|---|
| `EXCHANGE_FILE_BINANCE` | Historial de trades spot | `PENDING_SAMPLE` | — | Pendiente (owner) |
| `EXCHANGE_FILE_BINANCE` | Depósitos y retiros | `PENDING_SAMPLE` | — | Pendiente (owner) |
| `EXCHANGE_FILE_BYBIT` | Historial de trades spot | `PENDING_SAMPLE` | — | Pendiente (owner) |
| `EXCHANGE_FILE_BYBIT` | Depósitos y retiros | `PENDING_SAMPLE` | — | Pendiente (owner) |
| `FAKE_EXCHANGE_FILE` (solo pruebas) | JSON `pfos.fake-exchange-history` v1 | `VERIFIED` (sintético) | `packages/contexts/imports/src/testing/banking.file.test.ts` | n/a |

## Contrato común de una ficha (cuando haya muestra)

1. Columnas obligatorias y su significado (tipo de registro, identificador del exchange, instante, activos y montos, comisión, precio).
2. Separador, codificación y zona de las fechas; formato de números (texto decimal exacto, sin redondeo; INV-001, INV-003).
3. Cómo se obtiene el identificador **estable** del registro: el mismo que devuelve la API privada del mismo exchange, para que el archivo y la API compartan la referencia `imports.provider:<EXCHANGE>:<TIPO>` (INV-014).
4. Qué filas se excluyen (P2P, futuros, margen, staking detallado) y con qué motivo (`CONNECTION_RECORD_UNSUPPORTED`).
5. Golden files con comparación estructural exacta y un fixture anonimizado.

La puerta para pasar a `VERIFIED` es la tarea 9.3 de `add-banking-providers` (owner); el adapter es la 9.4.
