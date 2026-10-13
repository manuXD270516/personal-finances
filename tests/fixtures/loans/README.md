# Golden files de tablas de amortización del banco (ficticios)

Archivos **ficticios** para probar la carga de la tabla de amortización de un préstamo (`add-loans` 8.4, D154): ningún
dato real ni la tabla del banco del owner (esa se carga solo en la app, nunca en el repositorio). El formato imita los
planes de pagos que emiten los bancos bolivianos: separador `;`, coma decimal, miles con punto, fechas `dd/mm/aaaa`,
moneda BOB.

| Carpeta | Contenido |
|---|---|
| `plan-pagos-vehicular/input.csv` | Crédito vehicular ficticio: Bs 85.000,00, 36 cuotas mensuales, 11,50 % nominal anual, día-conteo 30/360, método francés, desembolso 15/10/2026. Coincide con el cronograma del sistema (comparación `MATCH`). |
| `plan-pagos-vehicular/variante-fechas-banco.csv` | Igual, pero el vencimiento de la cuota 7 pasa del sábado 15/05/2027 al lunes 17/05/2027, como hacen los bancos con vencimientos en día inhábil (comparación con diferencia de fecha, a explicar como `EXPLAINED`). |
| `plan-pagos-vehicular/extracto-impreso.txt` | El mismo plan con el diseño de un extracto impreso/PDF (encabezado ficticio «Banco Ejemplo S.A.»), para pegar en la planilla o probar la detección de separador. |

Mapeo para el CSV: `Nro Cuota` → n, `Fecha Vencimiento` → fecha (`DD/MM/YYYY`), `Capital`, `Interes`, `Total Cuota`,
`Saldo Capital`; separador decimal `,`.
