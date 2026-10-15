import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_CATEGORIES,
  KIND_OF_CATEGORY,
  NOT_ELIGIBLE_REASONS,
  validateCatalog,
  type CatalogIssue,
} from './institution-catalog.js';
import {
  DEMO_EVALUATED_ON,
  demoCatalog,
  demoEntry,
  demoTerms,
  status,
  threeEntryCatalog,
} from './institution-catalog.test-support.js';

const issuesOf = (raw: unknown): CatalogIssue[] => {
  const r = validateCatalog(raw, { terms: demoTerms });
  return r.ok ? [] : [...r.issues];
};
const codesOf = (raw: unknown) => issuesOf(raw).map((i) => i.code);

describe('CatalogValidator (accounts/institutions: estado de soporte y completitud del censo)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-006] una versión correcta se valida y devuelve los estados por entrada', () => {
    const result = validateCatalog(threeEntryCatalog(), { terms: demoTerms });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bad = result.catalog.entries.find((e) => e.code === 'BAD');
    expect(bad?.support.rates.status).toBe('IN_VERIFICATION');
    expect(bad?.support.statementImport.status).toBe('PENDING_SAMPLE');
    const bal = result.catalog.entries.find((e) => e.code === 'BAL');
    expect(bal?.support.rates.status).toBe('NOT_APPLICABLE');
    expect(bal?.support.statementImport.status).toBe('GENERIC_ONLY');
    expect(result.catalog.catalogVersion).toBe('2026-09-30');
    expect(result.catalog.source.cutoffDate).toBe('2026-09-30');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] NOT_ELIGIBLE sin razón falla la validación', () => {
    const raw = threeEntryCatalog();
    const entries = raw['entries'] as Record<string, unknown>[];
    entries[1] = demoEntry('CID', {
      category: 'SAVINGS_COOP',
      support: { rates: status('NOT_ELIGIBLE'), statementImport: status('PENDING_SAMPLE') },
    });
    const issues = issuesOf(raw);
    expect(issues.map((i) => i.code)).toContain('NOT_ELIGIBLE_REASON_REQUIRED');
    expect(issues.find((i) => i.code === 'NOT_ELIGIBLE_REASON_REQUIRED')?.path).toBe(
      '/entries/1/support/rates/reason',
    );
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] NOT_ELIGIBLE sin la fecha de la evaluación falla', () => {
    const raw = threeEntryCatalog();
    (raw['entries'] as Record<string, unknown>[])[1] = demoEntry('CID', {
      category: 'SAVINGS_COOP',
      support: {
        rates: { status: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
        statementImport: status('PENDING_SAMPLE'),
      },
    });
    expect(codesOf(raw)).toContain('EVALUATED_ON_REQUIRED');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] una razón fuera del conjunto cerrado falla y OTHER exige nota', () => {
    const withReason = (reason: string, extra: Record<string, unknown> = {}) => {
      const raw = threeEntryCatalog();
      (raw['entries'] as Record<string, unknown>[])[1] = demoEntry('CID', {
        category: 'SAVINGS_COOP',
        support: {
          rates: status('NOT_ELIGIBLE', { reason, ...extra }),
          statementImport: status('PENDING_SAMPLE'),
        },
      });
      return raw;
    };
    expect(codesOf(withReason('PORQUE_SI'))).toContain('NOT_ELIGIBLE_REASON_INVALID');
    expect(codesOf(withReason('OTHER'))).toContain('NOT_ELIGIBLE_NOTE_REQUIRED');
    expect(codesOf(withReason('OTHER', { note: 'solo en sucursal' }))).toEqual([]);
    for (const reason of NOT_ELIGIBLE_REASONS.filter((r) => r !== 'OTHER')) {
      expect(codesOf(withReason(reason))).toEqual([]);
    }
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] la razón solo se admite con NOT_ELIGIBLE', () => {
    const raw = threeEntryCatalog();
    (raw['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
      support: {
        rates: status('IN_VERIFICATION', { reason: 'NO_PUBLICATION' }),
        statementImport: status('PENDING_SAMPLE'),
      },
    });
    expect(codesOf(raw)).toContain('REASON_NOT_ALLOWED');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] un estado fuera de la dimensión falla (GENERIC_ONLY y PENDING_SAMPLE solo en importación)', () => {
    const raw = threeEntryCatalog();
    (raw['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
      support: { rates: status('GENERIC_ONLY'), statementImport: status('PENDING_SAMPLE') },
    });
    expect(codesOf(raw)).toContain('SUPPORT_STATUS_INVALID');
    const raw2 = threeEntryCatalog();
    (raw2['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
      support: { rates: status('PENDING_SAMPLE'), statementImport: status('PENDING_SAMPLE') },
    });
    expect(codesOf(raw2)).toContain('SUPPORT_STATUS_INVALID');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] SUPPORTED en tasas con un proveedor sin verificación falla', () => {
    const supported = (providerIds: string[] | undefined) => {
      const raw = threeEntryCatalog();
      (raw['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
        support: {
          rates: status('SUPPORTED', { adr: 'ADR-TEST', ...(providerIds ? { providerIds } : {}) }),
          statementImport: status('PENDING_SAMPLE'),
        },
      });
      return raw;
    };
    expect(codesOf(supported(['INSTRATE_UNVERIFIED']))).toContain('PROVIDER_TERMS_NOT_VERIFIED');
    expect(codesOf(supported(['INSTRATE_DESCONOCIDO']))).toContain('PROVIDER_TERMS_NOT_VERIFIED');
    expect(codesOf(supported(undefined))).toContain('SUPPORTED_WITHOUT_PROVIDER');
    expect(codesOf(supported([]))).toContain('SUPPORTED_WITHOUT_PROVIDER');
    expect(codesOf(supported(['INSTRATE_VERIFIED']))).toEqual([]);
  });

  it('[TC-FX-INSTRATE-002] una entidad SUPPORTED por una fuente cuyos términos prohíben la automatización (REJECTED) falla', () => {
    const raw = threeEntryCatalog();
    (raw['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
      support: {
        rates: status('SUPPORTED', { adr: 'ADR-TEST', providerIds: ['INSTRATE_REJECTED'] }),
        statementImport: status('PENDING_SAMPLE'),
      },
    });
    const issues = issuesOf(raw);
    expect(issues.map((i) => i.code)).toContain('PROVIDER_TERMS_NOT_VERIFIED');
    // La alternativa válida: la entidad queda NOT_ELIGIBLE con la razón o IN_VERIFICATION.
    (raw['entries'] as Record<string, unknown>[])[0] = demoEntry('BAD', {
      support: {
        rates: status('NOT_ELIGIBLE', { reason: 'TERMS_PROHIBIT_AUTOMATION' }),
        statementImport: status('PENDING_SAMPLE'),
      },
    });
    expect(codesOf(raw)).toEqual([]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-009] un censo de 2 bancos múltiples con 1 entrada falla indicando la categoría y la diferencia', () => {
    const raw = demoCatalog([demoEntry('BAD')], [{ category: 'MULTIPLE_BANK', count: 2 }]);
    const issues = issuesOf(raw);
    const shortfall = issues.find((i) => i.code === 'CENSUS_SHORTFALL');
    expect(shortfall).toBeDefined();
    expect(shortfall?.message).toContain('MULTIPLE_BANK');
    expect(shortfall?.details).toEqual({ category: 'MULTIPLE_BANK', census: 2, entries: 1, missing: 1 });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-009] un código repetido falla', () => {
    const raw = demoCatalog(
      [demoEntry('BAD'), demoEntry('BAD', { name: 'Otra Demo' })],
      [{ category: 'MULTIPLE_BANK', count: 2 }],
    );
    const dup = issuesOf(raw).find((i) => i.code === 'DUPLICATE_CODE');
    expect(dup?.details).toEqual({ code: 'BAD' });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-009] un catálogo sin fecha de corte (o sin fuente o fecha de consulta) falla', () => {
    const source = (patch: Record<string, unknown>) =>
      threeEntryCatalog({
        source: {
          name: 'Registro Demo',
          url: 'https://example.invalid/r',
          cutoffDate: '2026-09-30',
          retrievedOn: '2026-10-15',
          ...patch,
        },
      });
    expect(codesOf(source({ cutoffDate: undefined }))).toContain('CUTOFF_DATE_REQUIRED');
    expect(codesOf(source({ cutoffDate: '2026-02-31' }))).toContain('CUTOFF_DATE_REQUIRED');
    expect(codesOf(source({ retrievedOn: undefined }))).toContain('RETRIEVED_ON_REQUIRED');
    expect(codesOf(source({ name: '' }))).toContain('SOURCE_REQUIRED');
    expect(codesOf(threeEntryCatalog({ source: undefined }))).toContain('SOURCE_REQUIRED');
  });

  it('una categoría con entradas pero sin censo declarado falla', () => {
    const raw = demoCatalog([demoEntry('BAD')], []);
    expect(codesOf(raw)).toContain('CENSUS_MISSING');
  });

  it('las entradas DELISTED no cuentan para el censo y exigen la fecha del retiro', () => {
    const delisted = demoEntry('CAN', { listing: { status: 'DELISTED', since: '2026-06-30' } });
    // Censo 1 con 1 activa + 1 retirada: cumple.
    expect(
      codesOf(demoCatalog([demoEntry('BAD'), delisted], [{ category: 'MULTIPLE_BANK', count: 1 }])),
    ).toEqual([]);
    // Censo 2 con 1 activa + 1 retirada: las retiradas no completan el censo.
    expect(
      codesOf(demoCatalog([demoEntry('BAD'), delisted], [{ category: 'MULTIPLE_BANK', count: 2 }])),
    ).toContain('CENSUS_SHORTFALL');
    const noSince = demoEntry('CAN', { listing: { status: 'DELISTED', since: null } });
    expect(
      codesOf(demoCatalog([demoEntry('BAD'), noSince], [{ category: 'MULTIPLE_BANK', count: 1 }])),
    ).toContain('DELISTED_SINCE_REQUIRED');
  });

  it('valida la forma de cada entrada: código, nombre, categoría, tipo coherente, sitio web', () => {
    const one = (overrides: Record<string, unknown>) =>
      codesOf(demoCatalog([demoEntry('BAD', overrides)], [{ category: 'MULTIPLE_BANK', count: 1 }]));
    expect(one({ code: 'bad' })).toContain('CODE_INVALID');
    expect(one({ name: '' })).toContain('NAME_INVALID');
    expect(one({ name: 'x'.repeat(101) })).toContain('NAME_INVALID');
    expect(one({ category: 'INEXISTENTE' })).toContain('CATEGORY_INVALID');
    expect(one({ kind: 'WALLET_PROVIDER' })).toContain('CATEGORY_KIND_MISMATCH');
    expect(one({ website: 'ftp://x.example.invalid' })).toContain('WEBSITE_INVALID');
    expect(one({ verification: { status: 'QUIZAS', note: null } })).toContain('VERIFICATION_INVALID');
    expect(one({ listing: { status: 'EN_ESPERA', since: null } })).toContain('LISTING_INVALID');
    expect(one({ website: 'https://x.example.invalid' })).toEqual([]);
  });

  it('el tipo de cada categoría sigue el mapeo del diseño (decisión 2: sin ampliar InstitutionKind)', () => {
    expect(KIND_OF_CATEGORY).toEqual({
      MULTIPLE_BANK: 'BANK',
      SME_BANK: 'BANK',
      PUBLIC_BANK: 'BANK',
      DEVELOPMENT_BANK: 'BANK',
      HOUSING_FINANCE: 'BANK',
      SAVINGS_COOP: 'BANK',
      DEVELOPMENT_FINANCE: 'BANK',
      MOBILE_PAYMENT: 'WALLET_PROVIDER',
      FINTECH: 'FINTECH',
      EXCHANGE_HOUSE: 'OTHER',
    });
  });

  it('las casas de cambio no son adoptables y las demás categorías sí', () => {
    const house = demoEntry('CCS', { category: 'EXCHANGE_HOUSE', kind: 'OTHER' });
    const r = validateCatalog(
      demoCatalog(
        [demoEntry('BAD'), house],
        [
          { category: 'MULTIPLE_BANK', count: 1 },
          { category: 'EXCHANGE_HOUSE', count: 1 },
        ],
      ),
      { terms: demoTerms },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.catalog.entries.find((e) => e.code === 'CCS')?.adoptable).toBe(false);
    expect(r.catalog.entries.find((e) => e.code === 'BAD')?.adoptable).toBe(true);
    const bad = demoCatalog(
      [demoEntry('CCS', { category: 'EXCHANGE_HOUSE', kind: 'OTHER', adoptable: true })],
      [{ category: 'EXCHANGE_HOUSE', count: 1 }],
    );
    expect(codesOf(bad)).toContain('EXCHANGE_HOUSE_NOT_ADOPTABLE');
  });

  it('rechaza un archivo que no es un objeto y entradas que no son objetos, sin lanzar', () => {
    expect(codesOf(null)).toContain('CATALOG_NOT_OBJECT');
    expect(codesOf([])).toContain('CATALOG_NOT_OBJECT');
    expect(codesOf(demoCatalog(['no soy objeto' as never], []))).toContain('ENTRY_NOT_OBJECT');
    expect(codesOf({ ...threeEntryCatalog(), country: 'Bolivia' })).toContain('COUNTRY_INVALID');
    expect(codesOf({ ...threeEntryCatalog(), catalogVersion: '' })).toContain('CATALOG_VERSION_REQUIRED');
    expect(codesOf({ ...threeEntryCatalog(), entries: undefined })).toContain('ENTRIES_REQUIRED');
  });

  it('el campo fictitious se conserva como bandera del catálogo', () => {
    const r = validateCatalog(threeEntryCatalog(), { terms: demoTerms });
    expect(r.ok && r.catalog.fictitious).toBe(true);
    const real = validateCatalog(threeEntryCatalog({ fictitious: undefined }), { terms: demoTerms });
    expect(real.ok && real.catalog.fictitious).toBe(false);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-009] PBT: un catálogo generado coherente siempre valida; duplicar un código o quitar una entrada del censo siempre falla', () => {
    const categoryArb = fc.constantFrom(...CATALOG_CATEGORIES);
    const catalogArb = fc
      .uniqueArray(fc.tuple(fc.stringMatching(/^[A-Z][A-Z0-9]{2,5}$/), categoryArb), {
        minLength: 1,
        maxLength: 25,
        selector: ([code]) => code,
      })
      .map((rows) => {
        const entries = rows.map(([code, category]) =>
          demoEntry(code, {
            category,
            kind: KIND_OF_CATEGORY[category],
            ...(category === 'EXCHANGE_HOUSE' ? { adoptable: false } : {}),
          }),
        );
        const counts = new Map<string, number>();
        for (const [, category] of rows) counts.set(category, (counts.get(category) ?? 0) + 1);
        const census = [...counts].map(([category, count]) => ({ category, count }));
        return { entries, census };
      });
    fc.assert(
      fc.property(catalogArb, ({ entries, census }) => {
        expect(codesOf(demoCatalog(entries, census))).toEqual([]);
        const dup = [...entries, { ...entries[0], name: 'Copia Demo' }];
        const dupCensus = census.map((c) =>
          c.category === (entries[0] as { category: string }).category ? { ...c, count: c.count + 1 } : c,
        );
        expect(codesOf(demoCatalog(dup, dupCensus))).toContain('DUPLICATE_CODE');
        const short = census.map((c, i) => (i === 0 ? { ...c, count: c.count + 1 } : c));
        expect(codesOf(demoCatalog(entries, short))).toContain('CENSUS_SHORTFALL');
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('DEMO_EVALUATED_ON es una fecha ISO válida (guarda del soporte de pruebas)', () => {
    expect(DEMO_EVALUATED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
