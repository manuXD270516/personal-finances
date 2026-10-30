/**
 * Texto de un PDF con posiciones (openspec add-pdf-statement-parser decisión 5). Es el único contrato entre la
 * infraestructura (PDF.js en un hilo aislado) y el dominio: todo el algoritmo de reconstrucción es puro y se prueba
 * con documentos construidos en memoria, sin PDF.
 *
 * Las coordenadas son GEOMETRÍA en puntos (no dinero): `number` es correcto aquí. Origen arriba a la izquierda; `y` es
 * la línea base del fragmento.
 */
export interface PdfTextItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfTextPage {
  /** Número de página, desde 1. */
  readonly number: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly PdfTextItem[];
}

export interface PdfTextDocument {
  readonly pageCount: number;
  readonly pages: readonly PdfTextPage[];
}
