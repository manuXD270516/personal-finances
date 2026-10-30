import { describe, expect, it } from 'vitest';
import { MappingProfile } from './mapping-profile.js';
import { matchProfile, headerKey } from './profile-matcher.js';
import { parseProfileOptions } from './profile-options.js';

const csvOptions = (over: Record<string, unknown> = {}, amount?: unknown) => ({
  mapping: {
    hasHeader: true,
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
    columns: {
      date: { index: 0, header: 'Fecha' },
      description: { index: 1, header: 'Descripción' },
      amount: amount ?? { mode: 'SIGNED', index: 2, header: 'Monto', signConvention: 'NEGATIVE_IS_OUTFLOW' },
    },
    ...over,
  },
});

const create = (over: Partial<Parameters<typeof MappingProfile.create>[0]> = {}) =>
  MappingProfile.create({
    id: 'p1',
    workspaceId: 'w1',
    institutionId: 'inst-cumbre',
    accountId: null,
    name: 'Cumbre caja de ahorro CSV',
    format: 'CSV',
    options: csvOptions(),
    createdBy: 'ana',
    now: '2026-10-20T14:00:00.000Z',
    ...over,
  });

describe('MappingProfile', () => {
  it('[TC-IMPORTS-PIPELINE-025] guardar un mapeo crea la versión 1 con formato, columnas, formato de fecha y separador', () => {
    const profile = create();
    const v1 = profile.latest;
    expect(v1.version).toBe(1);
    expect(v1.institutionId).toBe('inst-cumbre');
    expect(v1.format).toBe('CSV');
    expect(v1.options.mapping?.dateFormat).toBe('dd/MM/yyyy');
    expect(v1.options.mapping?.decimalSeparator).toBe(',');
    expect(v1.options.mapping?.columns.amount.mode).toBe('SIGNED');
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it('[TC-IMPORTS-PIPELINE-026] editar crea la versión 2 y la 1 conserva su formato de fecha', () => {
    const profile = create();
    const v1 = profile.latest;
    const v2 = profile.newVersion({
      options: csvOptions({ dateFormat: 'yyyy-MM-dd' }),
      createdBy: 'ana',
      now: '2026-10-21T14:00:00.000Z',
    });
    expect(v2.version).toBe(2);
    expect(v2.options.mapping?.dateFormat).toBe('yyyy-MM-dd');
    expect(profile.version(1)).toBe(v1);
    expect(profile.version(1)?.options.mapping?.dateFormat).toBe('dd/MM/yyyy');
    expect(profile.state.versions).toHaveLength(2);
  });

  it('[TC-IMPORTS-PIPELINE-027] un perfil sin columna de monto se rechaza con IMPORT_MAPPING_INVALID', () => {
    const noAmount = csvOptions();
    delete (noAmount.mapping.columns as Record<string, unknown>)['amount'];
    expect(() => create({ options: noAmount })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
  });

  it('[TC-IMPORTS-PIPELINE-027] columnas repetidas, formato fuera de catálogo y perfil sin alcance se rechazan', () => {
    const repeated = csvOptions({}, { mode: 'SIGNED', index: 0, signConvention: 'NEGATIVE_IS_OUTFLOW' });
    expect(() => create({ options: repeated })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
    expect(() => create({ options: csvOptions({ dateFormat: 'dd.MM.yyyy' }) })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
    expect(() => create({ institutionId: null, accountId: null })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
  });

  it('OFX y JSON no llevan mapeo de columnas; QIF aporta el orden de fecha', () => {
    expect(parseProfileOptions('OFX', { descriptionCleanup: ['COMPRA '] }).descriptionCleanup).toEqual([
      'COMPRA ',
    ]);
    expect(parseProfileOptions('QIF', { dateOrder: 'DMY' }).dateOrder).toBe('DMY');
    expect(() => parseProfileOptions('OFX', csvOptions())).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
    expect(() => parseProfileOptions('CSV', { ...csvOptions(), dateOrder: 'DMY' })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_MAPPING_INVALID' }) as Error,
    );
  });

  it('un perfil archivado no admite nuevas versiones', () => {
    const profile = create();
    profile.archive('2026-10-22T10:00:00.000Z');
    expect(() =>
      profile.newVersion({ name: 'otro', createdBy: 'ana', now: '2026-10-22T11:00:00.000Z' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }) as Error);
  });
});

describe('ProfileMatcher', () => {
  const live = (profile: MappingProfile, updatedAt: string, archivedAt: string | null = null) => ({
    ...profile.latest,
    updatedAt,
    archivedAt,
  });
  const input = (header: string[], profiles: ReturnType<typeof live>[]) => ({
    header,
    format: 'CSV' as const,
    accountId: 'acc-bob',
    institutionId: 'inst-cumbre',
    profiles,
  });

  it('compara los encabezados sin mayúsculas ni acentos', () => {
    expect(headerKey('  DESCRIPCIÓN ')).toBe(headerKey('descripcion'));
  });

  it('[TC-IMPORTS-PIPELINE-029] aplica el perfil de la institución cuyas columnas coinciden, en su versión 2', () => {
    const profile = create();
    profile.newVersion({ options: csvOptions(), createdBy: 'ana', now: '2026-10-21T14:00:00.000Z' });
    const match = matchProfile(
      input(['FECHA', 'descripcion', 'Monto'], [live(profile, '2026-10-21T14:00:00.000Z')]),
    );
    expect(match.kind).toBe('APPLIED');
    if (match.kind === 'APPLIED') {
      expect(match.version).toBe(1 + 1);
      expect(match.mapping?.columns.amount.mode).toBe('SIGNED');
    }
  });

  it('resuelve la posición por nombre cuando el banco reordena las columnas', () => {
    const profile = create();
    const match = matchProfile(
      input(['Monto', 'Fecha', 'Descripción'], [live(profile, '2026-10-21T14:00:00.000Z')]),
    );
    expect(match.kind === 'APPLIED' && match.mapping?.columns.date.index).toBe(1);
    expect(match.kind === 'APPLIED' && match.mapping?.columns.description[0]?.index).toBe(2);
  });

  it('[TC-IMPORTS-PIPELINE-030] el perfil de la cuenta tiene prioridad sobre el de su institución', () => {
    const institution = create({ id: 'p-inst' });
    const account = create({ id: 'p-acc', institutionId: null, accountId: 'acc-bob', name: 'Cuenta' });
    const match = matchProfile(
      input(
        ['Fecha', 'Descripción', 'Monto'],
        [live(institution, '2026-10-25T00:00:00.000Z'), live(account, '2026-10-01T00:00:00.000Z')],
      ),
    );
    expect(match.kind === 'APPLIED' && match.profileId).toBe('p-acc');
  });

  it('[TC-IMPORTS-PIPELINE-031] un encabezado renombrado deja el perfil como candidato y "Monto" como faltante', () => {
    const profile = create();
    const match = matchProfile(
      input(['Fecha', 'Descripción', 'Importe'], [live(profile, '2026-10-21T14:00:00.000Z')]),
    );
    expect(match).toEqual({
      kind: 'AWAITING_MAPPING',
      candidates: [
        { profileId: 'p1', version: 1, name: 'Cumbre caja de ahorro CSV', missingColumns: ['Monto'] },
      ],
      missingColumns: ['Monto'],
    });
  });

  it('[TC-IMPORTS-PIPELINE-028] un perfil archivado no se sugiere ni se aplica', () => {
    const profile = create();
    const match = matchProfile(
      input(
        ['Fecha', 'Descripción', 'Monto'],
        [live(profile, '2026-10-21T14:00:00.000Z', '2026-10-22T10:00:00.000Z')],
      ),
    );
    expect(match).toEqual({ kind: 'NONE' });
  });

  it('otro formato u otra institución no coinciden', () => {
    const other = create({ institutionId: 'inst-otra' });
    expect(
      matchProfile(input(['Fecha', 'Descripción', 'Monto'], [live(other, '2026-10-21T14:00:00.000Z')])),
    ).toEqual({
      kind: 'NONE',
    });
  });

  it('en formatos autodescritos el perfil se aplica sin exigir columnas', () => {
    const ofx = MappingProfile.create({
      id: 'p-ofx',
      workspaceId: 'w1',
      institutionId: 'inst-cumbre',
      accountId: null,
      name: 'OFX Cumbre',
      format: 'OFX',
      options: { descriptionCleanup: ['COMPRA '] },
      createdBy: 'ana',
      now: '2026-10-20T14:00:00.000Z',
    });
    const match = matchProfile({
      header: [],
      format: 'OFX',
      accountId: 'acc-bob',
      institutionId: 'inst-cumbre',
      profiles: [live(ofx, '2026-10-21T14:00:00.000Z')],
    });
    expect(match.kind === 'APPLIED' && match.mapping).toBeNull();
  });
});
