import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Institution } from '../common/types';
import { esContext, textOf } from '../test-support';
import {
  adoptionBody,
  catalogStanding,
  categoriesOf,
  EMPTY_CATALOG_FILTERS,
  filterEntries,
  isSelectable,
  supportLabelKey,
  supportTone,
  type CatalogEntry,
  type InstitutionCatalogData,
} from './catalog-logic';
import { CatalogView } from './CatalogView';
import { CoverageView } from './CoverageView';
import { rateTypeLabel } from '../fx/ProvidersPanel';
import { CatalogStanding, SupportBadges } from './SupportBadges';

const f = esContext('Accounts');
const st = (status: string, reason: string | null = null) => ({
  status,
  reason,
  evaluatedOn: '2026-09-30',
  providerIds: [] as string[],
});
const entry = (over: Partial<CatalogEntry> & { code: string; name: string }): CatalogEntry => ({
  legalName: null,
  category: 'MULTIPLE_BANK',
  kind: 'BANK',
  adoptable: true,
  website: null,
  listingStatus: 'ACTIVE',
  delistedSince: null,
  verification: 'CONFIRMED',
  support: {
    rates: st('IN_VERIFICATION') as never,
    statementImport: st('PENDING_SAMPLE') as never,
  },
  adoptedInstitutionId: null,
  ...over,
});

// Datos de prueba FICTICIOS: cubren categorías, estados de soporte, razones, vigentes y retiradas.
const ENTRIES: CatalogEntry[] = [
  entry({ code: 'BAD', name: 'Banco Andino Demo' }),
  entry({
    code: 'BBD',
    name: 'Banco Boreal Demo',
    support: { rates: st('SUPPORTED') as never, statementImport: st('GENERIC_ONLY') as never },
  }),
  entry({
    code: 'CID',
    name: 'Cooperativa Illimani Demo',
    category: 'SAVINGS_COOP',
    support: {
      rates: st('NOT_ELIGIBLE', 'NO_PUBLICATION') as never,
      statementImport: st('NOT_APPLICABLE') as never,
    },
  }),
  entry({
    code: 'CAN',
    name: 'Cooperativa Antigua Demo',
    category: 'SAVINGS_COOP',
    listingStatus: 'DELISTED',
    delistedSince: '2026-06-30',
  }),
  entry({
    code: 'BAL',
    name: 'Billetera Altiplano Demo',
    category: 'MOBILE_PAYMENT',
    kind: 'WALLET_PROVIDER',
    adoptedInstitutionId: '0190a000-0000-7000-8000-000000000001',
  }),
  entry({
    code: 'FQD',
    name: 'Fintech Quimsa Demo',
    category: 'FINTECH',
    kind: 'FINTECH',
    verification: 'PENDING',
  }),
  entry({
    code: 'CCS',
    name: 'Casa de Cambio Sol Demo',
    category: 'EXCHANGE_HOUSE',
    kind: 'OTHER',
    adoptable: false,
  }),
];

const CATALOG: InstitutionCatalogData = {
  country: 'BO',
  catalogVersion: '2026-09-30',
  fictitious: true,
  source: { name: 'Registro Demo', url: null, cutoffDate: '2026-09-30', retrievedOn: '2026-10-13' },
  entries: ENTRIES,
  coverage: {
    complete: false,
    censusCoveragePct: '100.00',
    byCategory: [
      { category: 'MULTIPLE_BANK', census: 2, entries: 2, censusCoveragePct: '100.00' },
      { category: 'SAVINGS_COOP', census: 1, entries: 1, censusCoveragePct: '100.00' },
    ],
    byDimension: [
      {
        dimension: 'rates',
        resolved: 2,
        pending: 1,
        resolvedPct: '66.67',
        byStatus: [
          { status: 'SUPPORTED', reason: null, count: 1 },
          { status: 'IN_VERIFICATION', reason: null, count: 1 },
          { status: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION', count: 1 },
        ],
        notEligible: [{ reason: 'NO_PUBLICATION', count: 1 }],
      },
      {
        dimension: 'statementImport',
        resolved: 3,
        pending: 0,
        resolvedPct: '100.00',
        byStatus: [{ status: 'NOT_APPLICABLE', reason: null, count: 3 }],
        notEligible: [],
      },
    ],
  },
};

const noop = () => undefined;
const view = (over: Partial<Parameters<typeof CatalogView>[0]> = {}) =>
  renderToStaticMarkup(
    <CatalogView
      catalog={CATALOG}
      f={f}
      filters={EMPTY_CATALOG_FILTERS}
      selected={new Set()}
      canEdit
      busy={false}
      conflicts={[]}
      nameOfInstitution={(id) => (id === 'i1' ? 'Banco Andino' : id)}
      onFilters={noop}
      onToggle={noop}
      onAdopt={noop}
      onLink={noop}
      {...over}
    />,
  );

describe('catálogo de instituciones: lógica', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-001] filtra por nombre, sigla y categoría sin distinguir tildes', () => {
    expect(filterEntries(ENTRIES, { query: 'illimani', category: '' }).map((e) => e.code)).toEqual(['CID']);
    expect(filterEntries(ENTRIES, { query: 'bal', category: '' }).map((e) => e.code)).toContain('BAL');
    expect(filterEntries(ENTRIES, { query: 'BBD', category: '' }).map((e) => e.code)).toEqual(['BBD']);
    expect(filterEntries(ENTRIES, { query: '', category: 'SAVINGS_COOP' }).map((e) => e.code)).toEqual([
      'CID',
      'CAN',
    ]);
    expect(filterEntries(ENTRIES, { query: 'zzz', category: '' })).toEqual([]);
    expect(categoriesOf(ENTRIES)).toEqual([
      'MULTIPLE_BANK',
      'SAVINGS_COOP',
      'MOBILE_PAYMENT',
      'FINTECH',
      'EXCHANGE_HOUSE',
    ]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] solo se seleccionan las vigentes, adoptables y no vinculadas', () => {
    const by = Object.fromEntries(ENTRIES.map((e) => [e.code, isSelectable(e)]));
    expect(by).toEqual({ BAD: true, BBD: true, CID: true, CAN: false, BAL: false, FQD: true, CCS: false });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] el cuerpo de adopción lleva los vínculos solo cuando existen', () => {
    expect(adoptionBody('BO', ['BAD'])).toEqual({ country: 'BO', codes: ['BAD'] });
    expect(adoptionBody('BO', ['BAD'], [{ code: 'BAD', institutionId: 'i1' }])).toEqual({
      country: 'BO',
      codes: ['BAD'],
      links: [{ code: 'BAD', institutionId: 'i1' }],
    });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] clasifica el estado frente al catálogo vigente', () => {
    expect(catalogStanding({ listingStatus: 'ACTIVE', delistedSince: null })).toBe('LISTED');
    expect(catalogStanding({ listingStatus: 'DELISTED', delistedSince: '2026-06-30' })).toBe('DELISTED');
    expect(catalogStanding({ listingStatus: null, delistedSince: null })).toBe('NOT_IN_CATALOG');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] NOT_ELIGIBLE usa su razón; los estados desconocidos no rompen', () => {
    const has = f.has;
    expect(supportLabelKey(st('NOT_ELIGIBLE', 'TERMS_PROHIBIT_AUTOMATION') as never, has)).toBe(
      'support.reasons.TERMS_PROHIBIT_AUTOMATION',
    );
    expect(supportLabelKey(st('NOT_ELIGIBLE', 'RAZON_FUTURA') as never, has)).toBe(
      'support.states.NOT_ELIGIBLE',
    );
    expect(supportLabelKey(st('ESTADO_FUTURO') as never, has)).toBe('support.states.UNKNOWN');
    expect(supportTone(st('SUPPORTED') as never)).toBe('ok');
    expect(supportTone(st('PENDING_SAMPLE') as never)).toBe('pending');
    expect(supportTone(st('NOT_ELIGIBLE', 'OTHER') as never)).toBe('neutral');
  });
});

describe('catálogo de instituciones: vistas', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-001] muestra fuente, fecha de corte, versión y aviso de catálogo ficticio', () => {
    const text = textOf(view());
    expect(text).toContain('Catálogo de prueba con entidades ficticias');
    expect(text).toContain('Registro Demo');
    expect(text).toContain('30 sept de 2026');
    expect(text).toContain('versión 2026-09-30');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-001] sin aviso de ficticio cuando el catálogo es el real', () => {
    expect(textOf(view({ catalog: { ...CATALOG, fictitious: false } }))).not.toContain('ficticias');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] cada entrada dice su soporte por dimensión con texto y razón', () => {
    const html = view();
    const text = textOf(html);
    expect(text).toContain('Tasas: En verificación');
    expect(text).toContain('Extractos: Pendiente de muestra');
    expect(text).toContain('Tasas: Soportado');
    expect(text).toContain('Extractos: Solo formato genérico');
    expect(text).toContain('Tasas: No elegible: no publica tasas');
    expect(html).toContain('data-state="NOT_ELIGIBLE"');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] marca retiradas, ya agregadas, solo tasas y pendientes de confirmar', () => {
    const html = view();
    expect(textOf(html)).toContain('No figura en el registro desde 30 jun de 2026');
    expect(html).toContain('data-testid="catalog-adopted"');
    expect(html).toContain('data-testid="catalog-not-adoptable"');
    expect(html).toContain('data-testid="catalog-pending-verification"');
    // Las no seleccionables van deshabilitadas.
    const box = (code: string) =>
      new RegExp(`id="catalog-${code}"[^>]*disabled`).test(html) ||
      new RegExp(`disabled=""[^>]*id="catalog-${code}"`).test(html);
    expect(box('CAN')).toBe(true);
    expect(box('BAL')).toBe(true);
    expect(box('CCS')).toBe(true);
    expect(box('BAD')).toBe(false);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] un VIEWER ve el catálogo sin controles de selección ni botón de adopción', () => {
    const html = view({ canEdit: false });
    expect(html).not.toContain('type="checkbox"');
    expect(textOf(html)).not.toContain('Agregar seleccionadas');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] el botón cuenta la selección y se deshabilita sin ella', () => {
    const none = view();
    expect(textOf(none)).toContain('Agregar seleccionadas (0)');
    expect(none).toMatch(/<button[^>]*disabled[^>]*>Agregar seleccionadas \(0\)/);
    const two = view({ selected: new Set(['BAD', 'BBD']) });
    expect(textOf(two)).toContain('Agregar seleccionadas (2)');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] un conflicto de nombre ofrece vincular la institución existente', () => {
    const html = view({ conflicts: [{ code: 'BAD', reason: 'NAME_TAKEN', institutionId: 'i1' }] });
    expect(textOf(html)).toContain('«Banco Andino Demo» ya existe como «Banco Andino»');
    expect(textOf(html)).toContain('Vincular la existente');
    expect(
      view({ conflicts: [{ code: 'BAD', reason: 'NAME_TAKEN', institutionId: 'i1' }], canEdit: false }),
    ).not.toContain('Vincular la existente');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] una institución adoptada dada de baja o ausente avisa sin alterar nada', () => {
    const base = {
      country: 'BO',
      code: 'CAN',
      catalogVersion: '2026-03-31',
      support: null,
    };
    const delisted = textOf(
      renderToStaticMarkup(
        <CatalogStanding
          catalogRef={{ ...base, listingStatus: 'DELISTED', delistedSince: '2026-06-30' }}
          f={f}
        />,
      ),
    );
    expect(delisted).toContain('No figura en el registro desde 30 jun de 2026');
    const absent = textOf(
      renderToStaticMarkup(
        <CatalogStanding catalogRef={{ ...base, listingStatus: null, delistedSince: null }} f={f} />,
      ),
    );
    expect(absent).toContain('No figura en el catálogo de esta instalación');
    const listed = textOf(
      renderToStaticMarkup(
        <CatalogStanding
          catalogRef={{
            ...base,
            listingStatus: 'ACTIVE',
            delistedSince: null,
            support: { rates: st('SUPPORTED') as never, statementImport: st('PENDING_SAMPLE') as never },
          }}
          f={f}
        />,
      ),
    );
    expect(listed).not.toContain('No figura');
    expect(listed).toContain('Del catálogo: CAN (versión 2026-03-31)');
    expect(listed).toContain('Tasas: Soportado');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] un estado y una razón desconocidos del servidor se muestran sin romper', () => {
    const text = textOf(
      renderToStaticMarkup(
        <SupportBadges
          f={f}
          support={{
            rates: st('NOT_ELIGIBLE', 'RAZON_FUTURA') as never,
            statementImport: st('ESTADO_FUTURO') as never,
          }}
        />,
      ),
    );
    expect(text).toContain('Tasas: No elegible');
    expect(text).toContain('Extractos: Desconocido');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] el panel de cobertura informa censo, resueltas, pendientes y no elegibles aparte', () => {
    const html = renderToStaticMarkup(<CoverageView catalog={CATALOG} f={f} />);
    const text = textOf(html);
    expect(text).toContain('Cobertura incompleta.');
    expect(text).toContain('Censo cubierto: 100,00 %.');
    expect(text).toContain('Resueltas: 2 · pendientes: 1 · 66,67 %');
    expect(text).toContain('No elegibles, aparte: No elegible: no publica tasas: 1');
    expect(text).toContain('Banco múltiple');
    expect(text).toContain('Catálogo de prueba con entidades ficticias');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-008] con cobertura completa el panel lo dice', () => {
    const complete: InstitutionCatalogData = {
      ...CATALOG,
      fictitious: false,
      coverage: { ...CATALOG.coverage, complete: true },
    };
    const text = textOf(renderToStaticMarkup(<CoverageView catalog={complete} f={f} />));
    expect(text).toContain('Cobertura completa.');
    expect(text).not.toContain('ficticias');
  });
});

describe('presentación móvil', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-006] las insignias de soporte se parten en líneas y la tabla de cobertura tiene scroll propio accesible', () => {
    const html = view();
    expect(html).toMatch(/style="[^"]*white-space:normal[^"]*"[^>]*data-testid="support-rates"/);
    expect(html).not.toMatch(/white-space:nowrap/);
    const cov = renderToStaticMarkup(<CoverageView catalog={CATALOG} f={f} />);
    expect(cov).toMatch(/role="region"[^>]*aria-label="Cobertura del censo por categoría"/);
    expect(cov).toContain('tabindex="0"');
  });
});

describe('instituciones con vínculo al catálogo', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-002] el tipo Institution admite catalogRef opcional', () => {
    const plain: Institution = { id: 'a', name: 'Manual', kind: 'BANK', version: 1 };
    const linked: Institution = {
      ...plain,
      catalogRef: {
        country: 'BO',
        code: 'BAD',
        catalogVersion: '2026-09-30',
        listingStatus: 'ACTIVE',
        delistedSince: null,
      },
    };
    expect(plain.catalogRef).toBeUndefined();
    expect(linked.catalogRef?.code).toBe('BAD');
  });
});

describe('tasas por institución en la interfaz', () => {
  it('[TC-FX-INSTRATE-006] los tipos BANK_BUY y BANK_SELL tienen etiqueta propia desde el lado del owner', () => {
    const fx = esContext('Fx');
    expect(rateTypeLabel(fx, 'BANK_BUY')).toBe('Compra en entidad');
    expect(rateTypeLabel(fx, 'BANK_SELL')).toBe('Venta a entidad');
  });
});
