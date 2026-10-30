import { FilePdfLayoutRegistry } from '../../src/infrastructure/pdf/file-pdf-layout-registry.js';
import type { PdfLayout } from '../../src/domain/pdf/layout.js';
import type { EntityId } from '../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';

/** Diseños publicados, por entidad sintética de los fixtures. */
const IDS: Record<EntityId, string> = {
  BCP: 'bo.bcp.cuenta',
  GANADERO: 'bo.ganadero.cuenta',
  BNB: 'bo.bnb.cuenta',
};

export const REGISTRY = new FilePdfLayoutRegistry();

export function layoutFor(entity: EntityId, version = 1): PdfLayout {
  const layout = REGISTRY.get(IDS[entity], version);
  if (!layout) throw new Error(`layout ${IDS[entity]}@${version} not found`);
  return layout;
}

/** Diseño de prueba NO publicado: coma decimal y punto de miles, sobre la tabla de BCP (no entra al registro). */
export function commaDecimalLayout(): PdfLayout {
  const base = layoutFor('BCP');
  return { ...base, id: 'test.coma.decimal', number: { decimal: ',', thousands: '.' } };
}
