import { describe, expect, it } from 'vitest';
import { CatalogRef } from './catalog-ref.js';
import { Institution } from './institution.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('CatalogRef e Institution con vínculo opcional (accounts/institutions)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-002] el vínculo lleva país, código y versión del catálogo', () => {
    const ref = CatalogRef.of('BO', 'BAD', '2026-09-30');
    expect(ref.toJSON()).toEqual({ country: 'BO', code: 'BAD', version: '2026-09-30' });
    const i = Institution.create({
      id: 'i1',
      workspaceId: 'w1',
      name: 'Banco Andino Demo',
      kind: 'BANK',
      countryCode: 'BO',
      catalogRef: ref,
    });
    expect(i.snapshot.catalogRef?.code).toBe('BAD');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] los tres datos o ninguno: un vínculo parcial es inválido', () => {
    expect(CatalogRef.fromColumns(null, null, null)).toBeNull();
    expect(CatalogRef.fromColumns('BO', 'BAD', '2026-09-30')?.code).toBe('BAD');
    expect(codeOf(() => CatalogRef.fromColumns('BO', null, '2026-09-30'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => CatalogRef.fromColumns(null, 'BAD', null))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => CatalogRef.of('Bolivia', 'BAD', 'v1'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => CatalogRef.of('BO', 'bad', 'v1'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => CatalogRef.of('BO', 'BAD', ''))).toBe('VALIDATION_FAILED');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] renombrar conserva el vínculo; el vínculo no se edita', () => {
    const i = Institution.create({
      id: 'i1',
      workspaceId: 'w1',
      name: 'Banco Andino Demo',
      kind: 'BANK',
      catalogRef: CatalogRef.of('BO', 'BAD', '2026-09-30'),
    });
    expect(i.update({ name: 'Mi banco' })).toEqual(['name']);
    expect(i.snapshot.name).toBe('Mi banco');
    expect(i.snapshot.catalogRef?.code).toBe('BAD');
    expect(i.snapshot.catalogRef?.version).toBe('2026-09-30');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] vincular una institución creada a mano: una vez, idempotente con la misma entrada y rechazado con otra', () => {
    const i = Institution.create({ id: 'i1', workspaceId: 'w1', name: 'Banco Andino Demo', kind: 'BANK' });
    expect(i.snapshot.catalogRef).toBeNull();
    expect(i.linkToCatalog(CatalogRef.of('BO', 'BAD', '2026-09-30'))).toBe(true);
    expect(i.snapshot.version).toBe(2);
    expect(i.linkToCatalog(CatalogRef.of('BO', 'BAD', '2026-12-31'))).toBe(false);
    expect(i.snapshot.version).toBe(2);
    expect(codeOf(() => i.linkToCatalog(CatalogRef.of('BO', 'CID', '2026-09-30')))).toBe('VALIDATION_FAILED');
  });
});
