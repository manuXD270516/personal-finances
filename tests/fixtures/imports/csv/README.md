# Golden files de import CSV (anonimizados)

Archivos ficticios para `add-basic-csv-import` (docs/13 §16.1): ningun dato real. Cada carpeta es un extracto con su
`input.csv`; las pruebas leen los bytes tal cual (la codificacion importa).

| Carpeta | Codificacion / forma | Casos |
|---|---|---|
| `extracto-octubre` | windows-1252, `;`, coma decimal, miles con punto, 4 filas | TC-IMPORTS-CSV-001, -006, -015, -016, -019 |
| `debito-credito` | windows-1252, columnas Debito y Credito (una fila con ambas) | TC-IMPORTS-CSV-007 |
| `tarjeta-cargos-positivos` | UTF-8, cargos positivos de una tarjeta | TC-IMPORTS-CSV-008 |
| `fechas-mm-dd-yyyy` | UTF-8, `,`, punto decimal, fechas `MM/dd/yyyy` | TC-IMPORTS-CSV-012 |
| `identical-rows-same-day` | tres compras identicas el mismo dia | TC-IMPORTS-CSV-018 |
| `formula-description` | descripciones que empiezan con `=`, `+`, `@` | TC-IMPORTS-CSV-026 |
| `latin1-accents` | windows-1252 con acentos y enie | TC-IMPORTS-CSV-001 |
| `utf8-bom` | UTF-8 con BOM, CRLF | TC-IMPORTS-CSV-001 |
| `edge/png-renamed.csv` | PNG de 1x1 renombrado como CSV | TC-IMPORTS-CSV-005 |

El archivo de 5 000 filas (TC-IMPORTS-CSV-029) NO se versiona: lo genera `apps/api/test/perf/imports.perf.ts`.
