'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { Institution } from '../common/types';
import { cardStyle, mutedStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import {
  adoptionBody,
  CATALOG_COUNTRY,
  EMPTY_CATALOG_FILTERS,
  type AdoptionConflict,
  type AdoptionResult,
  type CatalogFilters,
  type InstitutionCatalogData,
} from './catalog-logic';
import { CatalogView } from './CatalogView';
import { CoverageView } from './CoverageView';

type CatalogState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly problem: ApiProblemBody }
  | { readonly kind: 'ready'; readonly catalog: InstitutionCatalogData };

const isNotFound = (err: unknown): boolean => err instanceof FinanceApiError && err.status === 404;

/** Carga el catálogo del país SOLO cuando `enabled` (al abrir el panel, no al montar la pantalla). */
export function useInstitutionCatalog(ctx: WorkspaceContext, enabled: boolean) {
  const [state, setState] = useState<CatalogState>({ kind: 'idle' });
  const load = useCallback(() => {
    setState({ kind: 'loading' });
    ctx.api
      .get<InstitutionCatalogData>(`${ctx.base}/institution-catalog?country=${CATALOG_COUNTRY}`)
      .then((res) => {
        if (res.data) setState({ kind: 'ready', catalog: res.data });
        else setState({ kind: 'unavailable' });
      })
      .catch((err: unknown) =>
        setState(isNotFound(err) ? { kind: 'unavailable' } : { kind: 'error', problem: problemOf(err) }),
      );
  }, [ctx.api, ctx.base]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  return { state, reload: load };
}

/**
 * "Agregar desde el catálogo" (FR-ACCOUNTS-012): panel plegado dentro de Instituciones; el catálogo se pide al
 * abrirlo. Selección múltiple, conflictos de nombre con vínculo explícito y aviso de catálogo ficticio.
 */
export function InstitutionCatalogPanel({
  ctx,
  institutions,
  onAdopted,
}: {
  ctx: WorkspaceContext;
  institutions: readonly Institution[];
  onAdopted: (message: string) => void;
}) {
  const f = useFormat('Accounts', ctx);
  const [open, setOpen] = useState(false);
  const { state, reload } = useInstitutionCatalog(ctx, open);
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_CATALOG_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [conflicts, setConflicts] = useState<readonly AdoptionConflict[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());

  async function adopt(codes: readonly string[], links: { code: string; institutionId: string }[] = []) {
    if (busy || codes.length === 0) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const res = await ctx.api.command<AdoptionResult>(
        'POST',
        `${ctx.base}/institutions/adopt`,
        adoptionBody(CATALOG_COUNTRY, codes, links),
        { idempotencyKey: key.current },
      );
      key.current = uuidv7();
      const result = res.data;
      setConflicts(result?.conflicts ?? []);
      setSelected(new Set((result?.conflicts ?? []).map((c) => c.code)));
      onAdopted(f.t('catalog.adoptedCount', { count: (result?.adopted.length ?? 0) + links.length }));
      reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const nameOfInstitution = (id: string) => institutions.find((i) => i.id === id)?.name ?? id;

  return (
    <section style={cardStyle} aria-labelledby="catalog-title" data-testid="catalog-panel">
      <h2 id="catalog-title" style={{ margin: 0, fontSize: '1rem' }}>
        {f.t('catalog.title')}
      </h2>
      <p style={mutedStyle}>{f.t('catalog.intro')}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="catalog-toggle">
        {open ? f.t('catalog.hide') : f.t('catalog.show')}
      </button>
      {open ? (
        <div style={{ marginTop: 'var(--pf-space-3)' }}>
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
          {state.kind === 'loading' || state.kind === 'idle' ? (
            <p aria-busy="true">{f.t('loading')}</p>
          ) : null}
          {state.kind === 'unavailable' ? (
            <p data-testid="catalog-unavailable">{f.t('catalog.unavailable')}</p>
          ) : null}
          {state.kind === 'error' ? <ProblemMessage problem={state.problem} locale={ctx.uiLocale} /> : null}
          {state.kind === 'ready' ? (
            <CatalogView
              catalog={state.catalog}
              f={f}
              filters={filters}
              selected={selected}
              canEdit={ctx.canEdit}
              busy={busy}
              conflicts={conflicts}
              nameOfInstitution={nameOfInstitution}
              onFilters={setFilters}
              onToggle={(code) => {
                const next = new Set(selected);
                if (next.has(code)) next.delete(code);
                else next.add(code);
                setSelected(next);
              }}
              onAdopt={() => void adopt([...selected])}
              onLink={(c) => void adopt([c.code], [{ code: c.code, institutionId: c.institutionId }])}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Configuración → Cobertura de soporte (FR-ACCOUNTS-012): cargada al abrir; 404 ⇒ "no disponible". */
export function CoveragePanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Accounts', ctx);
  const [open, setOpen] = useState(false);
  const { state } = useInstitutionCatalog(ctx, open);
  return (
    <section style={cardStyle} aria-labelledby="coverage-title" data-testid="coverage-panel">
      <h2 id="coverage-title" style={{ margin: 0, fontSize: '1rem' }}>
        {f.t('coverage.title')}
      </h2>
      <p style={mutedStyle}>{f.t('coverage.intro')}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="coverage-toggle">
        {open ? f.t('coverage.hide') : f.t('coverage.show')}
      </button>
      {open ? (
        <div style={{ marginTop: 'var(--pf-space-3)' }}>
          {state.kind === 'loading' || state.kind === 'idle' ? (
            <p aria-busy="true">{f.t('loading')}</p>
          ) : null}
          {state.kind === 'unavailable' ? (
            <p data-testid="coverage-unavailable">{f.t('catalog.unavailable')}</p>
          ) : null}
          {state.kind === 'error' ? <ProblemMessage problem={state.problem} locale={ctx.uiLocale} /> : null}
          {state.kind === 'ready' ? <CoverageView catalog={state.catalog} f={f} /> : null}
        </div>
      ) : null}
    </section>
  );
}
