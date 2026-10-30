# Fixtures sintéticos de import (add-import-pipeline)

TODO el contenido es **SINTETICO**: ningún dato de extractos reales del owner (D255, D281). Los lectores de OFX, QIF
y JSON los leen tal cual (los bytes importan); los XLSX no se versionan (se arman en memoria con
`packages/contexts/imports/src/testing/xlsx-builder.ts`), y el extracto de 5 000 movimientos lo genera
`packages/contexts/imports/src/testing/large-statement.ts` en memoria.

| Ruta | Forma | Casos |
|---|---|---|
| `ofx/extracto-sgml.ofx` | OFX 1.x SGML, BOB, 3 movimientos, saldo 1019.32 al 2026-03-31 | TC-IMPORTS-PIPELINE-013..015 |
| `ofx/extracto-xml.ofx` | OFX 2.x XML con comentario y `<MEMO></MEMO>` vacío | TC-IMPORTS-PIPELINE-011 |
| `ofx/extracto-usd.ofx` | OFX en USD (cuenta BOB ⇒ moneda distinta) | TC-IMPORTS-PIPELINE-016 |
| `ofx/extracto-xxe.ofx` | XML con `<!DOCTYPE>` y entidad externa (hostil) | TC-IMPORTS-PIPELINE-023 (seguridad) |
| `qif/banco.qif`, `qif/tarjeta.qif` | QIF banco y tarjeta, fecha `D03/04'26` | TC-IMPORTS-PIPELINE-017, -018 |
| `qif/divisiones-no-suman.qif` | −100.00 con divisiones −60.00 y −30.00 | TC-IMPORTS-PIPELINE-019 |
| `json/valido.json` | `pfos.import-file` v1, 3 movimientos | TC-IMPORTS-PIPELINE-020 |
| `json/monto-numero.json` | segundo monto como número JSON | TC-IMPORTS-PIPELINE-021 |
| `csv/banco-demo-perfil/input.csv` | preámbulo, pie de 2 filas, `D/C`, descripción en dos columnas, `Bs.`/`$us`, referencia repetida | TC-IMPORTS-PIPELINE-032..035, -053 |
| `tres-meses/enero-15feb.csv`, `tres-meses/feb-mar.ofx` | 52 + 75 movimientos con 12 solapados ⇒ 115 distintos | TC-IMPORTS-PIPELINE-055, -056 |
