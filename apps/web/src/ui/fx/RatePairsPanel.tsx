'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  badgeStyle,
  cardStyle,
  cellStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatAge } from '../dashboard/format';
import { RateAttributionLink } from '../dashboard/RateSourceBadge';
import type { FormatContext } from '../dashboard/types';
import { providerName, type FxProviderStatus } from './providers-logic';
import { rateTypeLabel } from './ProvidersPanel';
import {
  addPair,
  allowedQuotes,
  attributionByProvider,
  listChanged,
  pairKey,
  removePair,
  requestBody,
  statusByPair,
  type AddPairError,
  type FxPair,
  type FxRatePairList,
  type FxRatePairStatus,
  type PairMode,
} from './rate-pairs-logic';

/** Configuración → Tasas automáticas (add-crypto-rate-providers 6.1): lista de pares con cobertura y antigüedad. */
export function RatePairsPanel() {
  return <WithWorkspace>{(ctx) => <RatePairsLoader ctx={ctx} />}</WithWorkspace>;
}

interface Loaded {
  readonly list: FxRatePairList;
  readonly etag: string | undefined;
  readonly statuses: readonly FxRatePairStatus[];
  readonly providers: readonly FxProviderStatus[];
}

function RatePairsLoader({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('RatePairs', ctx);
  const dash = useFormat('Dashboard', ctx);
  const fx = useFormat('Fx', ctx);
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    ctx.api
      .get<FxRatePairList>(`${ctx.base}/fx-rate-pairs`)
      .then(async (listRes) => {
        // El estado aporta la antigüedad de la última tasa automática de cada par y la atribución de las fuentes.
        let statuses: readonly FxRatePairStatus[] = [];
        let providers: readonly FxProviderStatus[] = [];
        try {
          const st = await ctx.api.get<{ data: FxProviderStatus[]; pairs?: FxRatePairStatus[] }>(
            `${ctx.base}/fx-providers/status`,
          );
          statuses = st.data?.pairs ?? [];
          providers = st.data?.data ?? [];
        } catch {
          // Sin estado la lista igual se muestra (sin antigüedad).
        }
        if (listRes.data) setLoaded({ list: listRes.data, etag: listRes.etag, statuses, providers });
      })
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base]);
  useEffect(load, [load]);

  async function save(mode: PairMode, draft: readonly FxPair[]) {
    if (!loaded) return;
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      await ctx.api.command<FxRatePairList>('PUT', `${ctx.base}/fx-rate-pairs`, requestBody(mode, draft), {
        ifMatch: loaded.etag ?? loaded.list.version,
        idempotent: false,
      });
      setStatus(f.t('saved'));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const conflict = problem?.code === 'PRECONDITION_FAILED' || problem?.code === 'CONCURRENCY_CONFLICT';
  return (
    <>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {status ? (
        <p role="status" data-testid="rate-pairs-notice">
          {status}
        </p>
      ) : null}
      {loaded ? (
        <RatePairsView
          // Al recargar (nueva versión) el borrador parte de lo guardado.
          key={`${loaded.list.version}:${loaded.list.mode}`}
          list={loaded.list}
          statuses={loaded.statuses}
          providers={loaded.providers}
          f={f}
          dash={dash}
          fx={fx}
          baseCurrency={ctx.ws.baseCurrency}
          enabledCurrencies={ctx.currencies.filter((c) => c.enabled).map((c) => c.code)}
          canEdit={ctx.canEdit}
          busy={busy}
          conflict={conflict}
          onSave={(mode, draft) => void save(mode, draft)}
          onReload={() => {
            setProblem(undefined);
            load();
          }}
        />
      ) : problem ? null : (
        <p aria-busy="true">{f.t('loading')}</p>
      )}
    </>
  );
}

/**
 * Lista de pares automáticos (D220, D230): por defecto o personalizada, con cobertura (automática o solo tasas
 * manuales), fuentes con su atribución y antigüedad de la última tasa. Solo OWNER y EDITOR la cambian (If-Match con la
 * versión); VIEWER la ve en solo lectura. Presentacional: recibe la lista ya cargada.
 */
export function RatePairsView({
  list,
  statuses,
  providers,
  f,
  dash,
  fx,
  baseCurrency,
  enabledCurrencies,
  canEdit,
  busy = false,
  conflict = false,
  onSave,
  onReload,
}: {
  list: FxRatePairList;
  statuses: readonly FxRatePairStatus[];
  providers: readonly FxProviderStatus[];
  f: FormatContext;
  /** Namespace `Dashboard`: antigüedades legibles. */
  dash: FormatContext;
  /** Namespace `Fx`: etiquetas de los tipos de tasa. */
  fx: FormatContext;
  baseCurrency: string;
  enabledCurrencies: readonly string[];
  canEdit: boolean;
  busy?: boolean;
  conflict?: boolean;
  onSave?: (mode: PairMode, draft: readonly FxPair[]) => void;
  onReload?: () => void;
}) {
  const [mode, setMode] = useState<PairMode>(list.mode);
  const [draft, setDraft] = useState<readonly FxPair[]>(
    list.pairs.map((p) => ({ base: p.base, quote: p.quote })),
  );
  const [base, setBase] = useState('');
  const [quote, setQuote] = useState(baseCurrency);
  const [error, setError] = useState<AddPairError | undefined>();
  const changed = listChanged(list, mode, draft);
  const statusOf = statusByPair(statuses);
  const attribution = attributionByProvider(providers);
  const quotes = allowedQuotes(baseCurrency);
  // En modo CUSTOM la tabla muestra el borrador; en DEFAULT, la lista derivada del servidor.
  const rows =
    mode === 'CUSTOM'
      ? draft.map((p) => ({
          ...p,
          view: list.pairs.find((v) => pairKey(v) === pairKey(p)) ?? null,
        }))
      : list.pairs.map((p) => ({ base: p.base, quote: p.quote, view: p }));

  function add() {
    const r = addPair(draft, base, quote, baseCurrency);
    if (r.error) {
      setError(r.error);
      return;
    }
    setError(undefined);
    setDraft(r.pairs);
    setBase('');
  }

  return (
    <form
      aria-labelledby="rate-pairs-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)', maxWidth: '64rem' }}
      data-testid="rate-pairs"
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit && changed) onSave?.(mode, draft);
      }}
    >
      <h2 id="rate-pairs-title">{f.t('title')}</h2>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {canEdit ? null : (
        <p style={mutedStyle} data-testid="rate-pairs-readonly">
          {f.t('readOnly')}
        </p>
      )}
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend>{f.t('mode.legend')}</legend>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start' }}>
          {(['DEFAULT', 'CUSTOM'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
              <input
                type="radio"
                name="rate-pairs-mode"
                value={m}
                checked={mode === m}
                disabled={!canEdit || busy}
                style={inputStyle}
                onChange={() => setMode(m)}
                data-testid={`rate-pairs-mode-${m}`}
              />
              {f.t(`mode.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {rows.length === 0 ? (
        <p style={mutedStyle}>{f.t('empty')}</p>
      ) : (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('tableRegion')}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.pair')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.class')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.rateType')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.coverage')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.providers')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.lastRate')}
                </th>
                {canEdit && mode === 'CUSTOM' ? (
                  <th scope="col" style={cellStyle}>
                    {f.t('columns.actions')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = pairKey(row);
                const st = statusOf.get(key);
                const v = row.view;
                const coverage = st?.coverage ?? v?.coverage ?? 'MANUAL_ONLY';
                const covering = st?.providers ?? v?.providers ?? [];
                return (
                  <tr key={key} data-testid="rate-pair-row" data-pair={key} data-coverage={coverage}>
                    <th scope="row" style={cellStyle}>
                      {row.base}/{row.quote}
                    </th>
                    <td style={cellStyle}>{v ? f.t(`assetClass.${v.assetClass}`) : '—'}</td>
                    <td style={cellStyle}>{v ? rateTypeLabel(fx, v.defaultRateType) : '—'}</td>
                    <td style={cellStyle}>
                      <span style={badgeStyle} data-testid="rate-pair-coverage">
                        {f.t(`coverage.${coverage}`)}
                      </span>
                      {coverage === 'MANUAL_ONLY' ? (
                        <span style={{ ...mutedStyle, display: 'block' }}>{f.t('manualOnlyHint')}</span>
                      ) : null}
                    </td>
                    <td style={cellStyle}>
                      {covering.length === 0 ? (
                        f.t('noProviders')
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                          {covering.map((p) => {
                            const a = attribution.get(p);
                            return (
                              <li key={p} data-testid="rate-pair-provider" data-provider={p}>
                                {a ? <RateAttributionLink attribution={a} /> : providerName(p)}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td style={cellStyle} data-testid="rate-pair-age">
                      {st && st.ageSeconds !== null ? (
                        <>
                          {f.t('lastRate', { age: formatAge(st.ageSeconds, dash.t) })}
                          {st.stale ? (
                            <>
                              {' · '}
                              <strong>{f.t('stale')}</strong>
                            </>
                          ) : null}
                        </>
                      ) : (
                        f.t('noRate')
                      )}
                    </td>
                    {canEdit && mode === 'CUSTOM' ? (
                      <td style={cellStyle}>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={f.t('remove', { pair: key })}
                          onClick={() => setDraft(removePair(draft, key))}
                          data-testid="rate-pair-remove"
                        >
                          ×
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && mode === 'CUSTOM' ? (
        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} data-testid="rate-pair-add">
          <legend>{f.t('add.legend')}</legend>
          <div style={rowStyle}>
            <label style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
              {f.t('add.base')}
              <select
                value={base}
                style={inputStyle}
                onChange={(e) => setBase(e.target.value)}
                data-testid="rate-pair-base"
              >
                <option value="" />
                {enabledCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
              {f.t('add.quote')}
              <select
                value={quote}
                style={inputStyle}
                onChange={(e) => setQuote(e.target.value)}
                data-testid="rate-pair-quote"
              >
                {quotes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={busy} onClick={add} data-testid="rate-pair-add-button">
              {f.t('add.button')}
            </button>
          </div>
          <p style={mutedStyle}>{f.t('add.baseHint')}</p>
          {error ? (
            <p role="alert" data-testid="rate-pair-error">
              {f.t(`errors.${error}`)}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {canEdit ? (
        <div style={rowStyle}>
          <button type="submit" disabled={busy || !changed} data-testid="rate-pairs-save">
            {f.t('save')}
          </button>
          {conflict && onReload ? (
            <button type="button" onClick={onReload} data-testid="rate-pairs-reload">
              {f.t('reload')}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
