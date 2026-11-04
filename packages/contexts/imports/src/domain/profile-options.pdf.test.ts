import { describe, expect, it } from 'vitest';
import { parseProfileOptions, serializeProfileOptions } from './profile-options.js';

describe('perfil PDF: fija el diseño y su versión, sin edición de columnas', () => {
  it('[TC-IMPORTS-PDF-013] acepta { pdfLayout: { id, version } } y descriptionCleanup, y lo devuelve igual', () => {
    const parsed = parseProfileOptions('PDF', {
      pdfLayout: { id: 'bo.ganadero.cuenta', version: 1 },
      descriptionCleanup: ['TRANSF. '],
    });
    expect(parsed).toMatchObject({
      mapping: null,
      pdfLayout: { id: 'bo.ganadero.cuenta', version: 1 },
      descriptionCleanup: ['TRANSF. '],
    });
    expect(parseProfileOptions('PDF', serializeProfileOptions(parsed))).toEqual(parsed);
  });

  it('exige el diseño en un perfil PDF y lo rechaza en los demás formatos; un PDF no lleva mapeo de columnas', () => {
    expect(() => parseProfileOptions('PDF', {})).toThrow(/layout/u);
    expect(() => parseProfileOptions('PDF', { pdfLayout: { id: 'x', version: 0 } })).toThrow(/version/u);
    expect(() => parseProfileOptions('PDF', { pdfLayout: { id: '', version: 1 } })).toThrow(/id/u);
    expect(() => parseProfileOptions('OFX', { pdfLayout: { id: 'bo.bcp.cuenta', version: 1 } })).toThrow(
      /PDF profiles/u,
    );
    expect(() =>
      parseProfileOptions('PDF', { pdfLayout: { id: 'bo.bcp.cuenta', version: 1 }, mapping: {} }),
    ).toThrow(/column mapping/u);
  });
});
