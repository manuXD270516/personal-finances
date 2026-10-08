'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import {
  policyChanged,
  POLICY_KINDS,
  type ClosingPolicy,
  type PolicyKind,
  type PolicySeverity,
} from './closing-logic';

export function ClosingPolicyPanel() {
  return <WithWorkspace>{(ctx) => <PolicyLoader ctx={ctx} />}</WithWorkspace>;
}

function PolicyLoader({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Closing', ctx);
  const [policy, setPolicy] = useState<ClosingPolicy | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    ctx.api
      .get<ClosingPolicy>(`${ctx.base}/planning/closing-policy`)
      .then((r) => setPolicy(r.data))
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx]);
  useEffect(load, [load]);

  async function save(severities: Readonly<Record<PolicyKind, PolicySeverity>>) {
    if (!policy) return;
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      const r = await ctx.api.command<ClosingPolicy>(
        'PUT',
        `${ctx.base}/planning/closing-policy`,
        { severities },
        { ifMatch: policy.version, idempotent: false },
      );
      if (r.data) setPolicy(r.data);
      setStatus(f.t('policy.saved'));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {status ? (
        <p role="status" data-testid="policy-notice">
          {status}
        </p>
      ) : null}
      {policy ? (
        <ClosingPolicyForm
          // Al recargar la política (nueva versión) el borrador parte de la guardada.
          key={policy.version}
          policy={policy}
          f={f}
          canEdit={ctx.ws.role === 'OWNER'}
          busy={busy}
          onSave={(s) => void save(s)}
          onReload={() => {
            setProblem(undefined);
            load();
          }}
          hasConflict={problem?.code === 'PRECONDITION_FAILED' || problem?.code === 'CONCURRENCY_CONFLICT'}
        />
      ) : problem ? null : (
        <p aria-busy="true">{f.t('policy.loading')}</p>
      )}
    </>
  );
}

/**
 * Política de cierre del workspace (openspec add-month-closing 6.2): severidad de cada ítem del checklist
 * (BLOQUEANTE o ADVERTENCIA). Solo el OWNER la edita (If-Match con la versión); los demás roles la ven en solo lectura.
 * El ítem informativo "conciliada sin extracto" no es configurable. Presentacional: recibe la política ya cargada.
 */
export function ClosingPolicyForm({
  policy,
  f,
  canEdit,
  busy = false,
  onSave,
  onReload,
  hasConflict = false,
}: {
  policy: ClosingPolicy;
  f: FormatContext;
  canEdit: boolean;
  busy?: boolean;
  onSave?: (severities: Readonly<Record<PolicyKind, PolicySeverity>>) => void;
  onReload?: () => void;
  hasConflict?: boolean;
}) {
  const [draft, setDraft] = useState<Readonly<Record<PolicyKind, PolicySeverity>>>(policy.severities);
  const changed = policyChanged(policy.severities, draft);
  return (
    <form
      aria-labelledby="closing-policy-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)', maxWidth: '64rem' }}
      data-testid="closing-policy"
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit && changed) onSave?.(draft);
      }}
    >
      <h2 id="closing-policy-title">{f.t('policy.title')}</h2>
      <p style={mutedStyle}>{f.t('policy.intro')}</p>
      {canEdit ? null : (
        <p style={mutedStyle} data-testid="policy-readonly">
          {f.t('policy.readOnly')}
        </p>
      )}
      <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
        {POLICY_KINDS.map((kind) => (
          <fieldset
            key={kind}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            data-testid="policy-item"
            data-kind={kind}
          >
            <legend>{f.t(`kinds.${kind}`)}</legend>
            {canEdit ? (
              <div style={rowStyle}>
                {(['BLOCKING', 'WARNING'] as const).map((severity) => (
                  <label
                    key={severity}
                    style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}
                  >
                    <input
                      type="radio"
                      name={`policy-${kind}`}
                      value={severity}
                      checked={draft[kind] === severity}
                      disabled={busy}
                      style={inputStyle}
                      onChange={() => setDraft({ ...draft, [kind]: severity })}
                      data-testid={`policy-${kind}-${severity}`}
                    />
                    {f.t(`tone.${severity}`)}
                  </label>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0 }} data-testid="policy-value">
                {f.t(`tone.${policy.severities[kind]}`)}
              </p>
            )}
          </fieldset>
        ))}
      </div>
      <p style={mutedStyle}>{f.t('policy.infoNote')}</p>
      {canEdit ? (
        <div style={rowStyle}>
          <button type="submit" disabled={busy || !changed} data-testid="policy-save">
            {f.t('policy.save')}
          </button>
          {hasConflict && onReload ? (
            <button type="button" onClick={onReload} data-testid="policy-reload">
              {f.t('policy.reload')}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
