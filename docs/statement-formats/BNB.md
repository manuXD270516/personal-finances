# Ficha de formato: BNB (Banco Nacional de Bolivia)

> **Estado:** Registrado · **Fecha:** 2026-10-16 · **Muestra:** una caja de ahorro en bolivianos, 4 páginas. Sin datos reales en esta ficha; fixture sintético en `tests/fixtures/imports/statements-bo/bnb` (institución ficticia "Banco Altiplano Demo").

## Origen y extracción

- **Generador:** wkhtmltopdf (HTML convertido a PDF, "Tu Banca Personal").
- **Texto extraíble:** sí, pero **`pdftotext -layout` desordena las columnas**: la fecha y la hora de un movimiento aparecen en líneas distintas de su descripción, a veces antes y a veces después; la referencia se pega al final de la glosa (`Compra QR<ref>`); fragmentos de "Dato Adicional" invaden la columna Referencia (`Cuenta: 00`); y una referencia larga se parte en dos líneas. Recomendación a validar en Phase 6: extraer palabras con coordenadas (`pdftotext -bbox-layout` o equivalente) y reconstruir cada fila por posición vertical, en vez de depender del texto plano.

## Encabezado

- Bloque de servicio al cliente y dirección del titular y del banco: **datos personales; descartar**.
- Periodo: `del 01 de marzo, 2026 al 31 de marzo, 2026` (día, **mes en texto español**, año). Número de cuenta: `000-0000001`. Tipo: `CAJA DE AHORRO UNICA`. En cada página se repite `<titular> | Número de cuenta: <n>`.
- **Resumen de cuenta:** Moneda (`BOLIVIANOS`), `Saldo al 01 de marzo, 2026`, `Total de débitos`, `Total de créditos`, `Total ITF`, `Saldo al 31 de marzo, 2026`. Miles con coma y decimal con punto (`5,000.00`).

## Movimientos en dos secciones

- **Depósitos:** columnas Fecha, Hora, Descripción, Referencia, Comprobante, ITF, **Créditos**. Cierra con `Total depósitos`.
- **Retiros:** columnas Fecha, Hora, Descripción, Referencia, Comprobante, ITF, **Débitos**. Cierra con `Total retiros`.
- **No hay saldo corrido.** El orden dentro de cada sección es cronológico en la muestra, pero no hay forma de intercalar depósitos y retiros por saldo; si hace falta un orden global, se usa fecha+hora.
- Fecha `DD/MM/AAAA`; hora `HH:MM` (sin segundos), que en el texto aparece en otra línea.
- **Monto con signo:** créditos positivos, débitos negativos (según la sección).
- **Referencia:** código alfanumérico por movimiento (`external id` candidato). Se repite entre un interés y su retención de IVA: no es único.
- **Contraparte** en texto libre de la descripción: `Cuenta Destino: <n>. Nombre: <nombre>. Banco: <banco>. Dato Adicional: <texto>`; después, a veces, una línea `CUENTA: <n> NOMBRE(S): <titular>` que repite al propio titular. Se puede extraer con expresiones sobre etiquetas fijas.
- **ITF:** columna propia (en la muestra, cero); `Total ITF` en el resumen.

## Casos especiales

- **Pago de interés** (sección Depósitos) y **retención de IVA** (sección Retiros), ambos con la hora `23:59` del último día.
- **Débito por seguro** y **transferencias interbancarias** (`DEBITO EN CUENTA POR TRANS. INTERBANC.`), **compras QR** y **débito en cuenta (móvil)**.
- **Página en blanco intencional:** `Esta página se dejó en blanco intencionalmente`; descartar sin error.
- **Sin actividad:** no observado (ambas secciones vacías con totales en cero).

## Riesgos de parseo

1. **Orden de columnas inestable** entre líneas (ver Origen): el parseo por texto plano es frágil; usar coordenadas.
2. Hora y fecha en líneas distintas, a veces con la fecha antes de la glosa y a veces la hora después.
3. Referencia pegada a la glosa (`Compra QR2D0000004`) y referencias partidas en dos líneas (`...-` seguido de la continuación).
4. Descripciones largas con contraparte y datos de terceros; fragmentos de "Dato Adicional" en la columna Referencia.
5. Dos secciones con totales propios: un movimiento puede perderse si solo se lee una.
6. Mes en texto español en el encabezado y en las etiquetas del resumen.
7. Páginas: encabezado repetido en cada página, página en blanco, pie `Página N de M`.

## Verificaciones de coherencia

- `Saldo al inicio + Total de créditos - Total de débitos = Saldo al final` (más `Total ITF` si el ITF se descuenta aparte; en la muestra era cero).
- `Total depósitos` = suma de la sección Depósitos = `Total de créditos`; `Total retiros` = suma de Retiros = `Total de débitos`.
- Número de páginas leídas = `M` de `Página N de M`.

## Valor recomendado de `statementImport`

**`PENDING_SAMPLE`.** Texto extraíble (no `IMAGE_ONLY_STATEMENT`), sin evidencia de una exportación CSV/XLS (no `GENERIC_ONLY`). Si el owner confirma una exportación, `GENERIC_ONLY`; si no, un perfil de PDF por coordenadas en Phase 6/11 lo llevaría a `SUPPORTED`. Si el parser por coordenadas resulta inestable, la razón de `NOT_ELIGIBLE` sería `UNSTABLE_FORMAT`, pero con una sola muestra no hay base para declararlo.
