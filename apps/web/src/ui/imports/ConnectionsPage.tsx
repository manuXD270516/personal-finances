'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  ConfirmPanel,
  Field,
  cardStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { uploadStatementDocument } from './document-upload';
import {
  canReplaceCredential,
  canRevoke,
  canSync,
  connectionPath,
  connectionsPath,
  createConnectionBody,
  isVerifying,
  providersPath,
  selectableProviders,
  statusHintKey,
  validateDraft,
  type BankingProviderView,
  type ConnectionDraft,
  type ConnectionView,
  type DraftErrors,
} from './connections-logic';
import { useAccounts, type AccountsLookup } from './useAccounts';

const POLL_MS = 2000;

export function ImportConnectionsPage() {
  return <WithWorkspace>{(ctx) => <Connections ctx={ctx} />}</WithWorkspace>;
}

const tone = (status: ConnectionView['status']) =>
  status === 'ACTIVE'
    ? ({ icon: '✓', tone: 'ok' } as const)
    : status === 'REVOKED' || status === 'REJECTED'
      ? ({ icon: '✕', tone: 'neutral' } as const)
      : ({ icon: '!', tone: 'warn' } as const);

/** Una conexión: estado, huella enmascarada (nunca el secreto), último error y acciones según el rol y el estado. */
export function ConnectionCard({
  connection,
  provider,
  f,
  accounts,
  canManage,
  canSyncRole,
  busy,
  onSync,
  onReplace,
  onRevoke,
  onUpload,
}: {
  connection: ConnectionView;
  provider: BankingProviderView | undefined;
  f: FormatContext;
  accounts: AccountsLookup;
  canManage: boolean;
  canSyncRole: boolean;
  busy: boolean;
  onSync: (c: ConnectionView, from: string | undefined) => void;
  onReplace: (c: ConnectionView) => void;
  onRevoke: (c: ConnectionView) => void;
  onUpload: (c: ConnectionView, file: File) => void;
}) {
  const [from, setFrom] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const hasCredential = provider !== undefined && provider.credentialMode !== 'NONE';
  const remote = hasCredential;
  const firstSync = connection.syncCursor === null;
  return (
    <li
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="connection-item"
      data-status={connection.status}
    >
      <div style={rowStyle}>
        <strong>{connection.name}</strong>
        <span style={mutedStyle}>{provider?.displayName ?? connection.providerId}</span>
        <Badge
          presentation={tone(connection.status)}
          label={f.t(`status.${connection.status}`)}
          status={connection.status}
          testId="connection-status"
        />
      </div>
      <p style={{ ...mutedStyle, margin: 0 }} data-testid="connection-hint">
        {f.t(statusHintKey(connection))}
      </p>
      {connection.credential ? (
        <p style={{ margin: 0 }} data-testid="connection-fingerprint">
          {f.t('fingerprint', { fingerprint: connection.credential.fingerprint })}
        </p>
      ) : null}
      {connection.lastError ? (
        <p style={{ margin: 0 }} role="status" data-testid="connection-last-error">
          {f.t('lastError', { code: connection.lastError.code })}
        </p>
      ) : null}
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="connection-mappings">
        {connection.assetMappings.map((m) => (
          <li key={m.asset}>
            {f.t('mapping', { asset: m.asset, account: accounts.byId(m.accountId)?.name ?? m.accountId })}
          </li>
        ))}
      </ul>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {connection.syncCursor ? f.t('cursor', { date: connection.syncCursor }) : f.t('cursorNone')}
        {connection.retryNotBefore ? ` · ${f.t('retryNotBefore', { at: connection.retryNotBefore })}` : ''}
      </p>
      {canSyncRole && canSync(connection, remote) ? (
        <div style={rowStyle}>
          {firstSync ? (
            <Field label={f.t('syncFrom')} hint={f.t('syncFromHint')}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  value={from}
                  style={inputStyle}
                  data-testid="connection-sync-from"
                  onChange={(e) => setFrom(e.target.value)}
                />
              )}
            </Field>
          ) : null}
          <button
            type="button"
            disabled={busy || (firstSync && from === '')}
            data-testid="connection-sync"
            onClick={() => onSync(connection, firstSync ? from : undefined)}
          >
            {f.t('sync')}
          </button>
        </div>
      ) : null}
      {canSyncRole && !remote && connection.status === 'ACTIVE' ? (
        <div style={rowStyle}>
          <input
            ref={fileInput}
            type="file"
            aria-label={f.t('uploadHistory')}
            data-testid="connection-history-file"
          />
          <button
            type="button"
            disabled={busy}
            data-testid="connection-upload"
            onClick={() => {
              const file = fileInput.current?.files?.[0];
              if (file) onUpload(connection, file);
            }}
          >
            {f.t('uploadHistory')}
          </button>
        </div>
      ) : null}
      {canManage ? (
        <div style={rowStyle}>
          {canReplaceCredential(connection, hasCredential) ? (
            <button
              type="button"
              disabled={busy}
              data-testid="connection-replace"
              onClick={() => onReplace(connection)}
            >
              {f.t('replace')}
            </button>
          ) : null}
          {canRevoke(connection) ? (
            <button
              type="button"
              disabled={busy}
              data-testid="connection-revoke"
              onClick={() => onRevoke(connection)}
            >
              {f.t('revoke')}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Alta de una conexión: el secreto es un campo de contraseña que no se vuelve a mostrar. */
export function ConnectionForm({
  f,
  providers,
  accounts,
  busy,
  onSubmit,
}: {
  f: FormatContext;
  providers: readonly BankingProviderView[];
  accounts: AccountsLookup;
  busy: boolean;
  onSubmit: (draft: ConnectionDraft, needsCredential: boolean) => void;
}) {
  const [providerId, setProviderId] = useState('');
  const [name, setName] = useState('');
  const [mappings, setMappings] = useState<{ asset: string; accountId: string }[]>([
    { asset: '', accountId: '' },
  ]);
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<DraftErrors>({});
  const provider = providers.find((p) => p.id === providerId);
  const needsCredential = provider !== undefined && provider.credentialMode !== 'NONE';

  function submit() {
    const draft: ConnectionDraft = { providerId, name, mappings, keyId, secret };
    const found = validateDraft(draft, needsCredential);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(draft, needsCredential);
    // El secreto no se conserva en el estado de la pantalla una vez enviado.
    setSecret('');
    setKeyId('');
  }

  return (
    <form
      style={formStyle}
      noValidate
      data-testid="connection-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2>{f.t('create.title')}</h2>
      <Field
        label={f.t('create.provider')}
        error={errors.provider ? f.t('create.errors.provider') : undefined}
      >
        {(p) => (
          <select
            {...p}
            value={providerId}
            style={inputStyle}
            data-testid="connection-provider"
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">{f.t('create.choose')}</option>
            {providers.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.displayName}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={f.t('create.name')} error={errors.name ? f.t('create.errors.name') : undefined}>
        {(p) => (
          <input
            {...p}
            value={name}
            maxLength={80}
            style={inputStyle}
            data-testid="connection-name"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>{f.t('create.mappings')}</legend>
        <p style={mutedStyle}>{f.t('create.mappingsHint')}</p>
        {errors.mappings ? (
          <p role="alert" data-testid="field-error">
            {f.t('create.errors.mappings')}
          </p>
        ) : null}
        {mappings.map((m, i) => (
          <div key={i} style={rowStyle}>
            <Field label={f.t('create.asset')}>
              {(p) => (
                <input
                  {...p}
                  value={m.asset}
                  maxLength={20}
                  style={inputStyle}
                  data-testid="connection-asset"
                  onChange={(e) =>
                    setMappings(mappings.map((x, j) => (j === i ? { ...x, asset: e.target.value } : x)))
                  }
                />
              )}
            </Field>
            <Field label={f.t('create.account')}>
              {(p) => (
                <select
                  {...p}
                  value={m.accountId}
                  style={inputStyle}
                  data-testid="connection-account"
                  onChange={(e) =>
                    setMappings(mappings.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))
                  }
                >
                  <option value="">{f.t('create.choose')}</option>
                  {accounts.active.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ))}
        <button type="button" onClick={() => setMappings([...mappings, { asset: '', accountId: '' }])}>
          {f.t('create.addMapping')}
        </button>
      </fieldset>
      {needsCredential ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{f.t('create.credential')}</legend>
          <p style={mutedStyle}>{f.t('create.readOnlyNotice')}</p>
          <Field label={f.t('create.keyId')} error={errors.keyId ? f.t('create.errors.keyId') : undefined}>
            {(p) => (
              <input
                {...p}
                value={keyId}
                autoComplete="off"
                style={inputStyle}
                data-testid="connection-key-id"
                onChange={(e) => setKeyId(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={f.t('create.secret')}
            hint={f.t('create.secretHint')}
            error={errors.secret ? f.t('create.errors.secret') : undefined}
          >
            {(p) => (
              <input
                {...p}
                type="password"
                value={secret}
                autoComplete="new-password"
                style={inputStyle}
                data-testid="connection-secret"
                onChange={(e) => setSecret(e.target.value)}
              />
            )}
          </Field>
        </fieldset>
      ) : null}
      <div>
        <button type="submit" disabled={busy} data-testid="connection-create">
          {f.t('create.submit')}
        </button>
      </div>
    </form>
  );
}

function Connections({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('ImportConnections', ctx);
  const accounts = useAccounts(ctx);
  const [providers, setProviders] = useState<readonly BankingProviderView[]>([]);
  const [items, setItems] = useState<readonly ConnectionView[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ConnectionView | undefined>();
  const [replacing, setReplacing] = useState<ConnectionView | undefined>();
  const [replaceKey, setReplaceKey] = useState('');
  const [replaceSecret, setReplaceSecret] = useState('');
  const { api, base } = ctx;
  const canManage = ctx.ws.role === 'OWNER';

  const load = useCallback(async () => {
    try {
      const [list, catalog] = await Promise.all([
        api.get<{ data: ConnectionView[] }>(connectionsPath(base)),
        api.get<{ data: BankingProviderView[] }>(providersPath(base)),
      ]);
      setItems(list.data?.data ?? []);
      setProviders(catalog.data?.data ?? []);
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
      setItems([]);
    }
  }, [api, base]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mientras el worker verifica una credencial, la pantalla consulta con frecuencia moderada.
  const verifying = items?.some((c) => isVerifying(c.status)) ?? false;
  useEffect(() => {
    if (!verifying) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [verifying, load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      await load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const providerOf = (id: string) => providers.find((p) => p.id === id);

  return (
    <section aria-labelledby="connections-title" style={pageStyle} data-testid="import-connections">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/imports')}>{f.t('back')}</a>
      </p>
      <h1 id="connections-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      {revoking ? (
        <ConfirmPanel
          testId="connection-revoke-confirm"
          title={f.t('revokeTitle', { name: revoking.name })}
          description={f.t('revokeBody')}
          confirmLabel={f.t('revoke')}
          cancelLabel={f.t('keep')}
          busy={busy}
          onConfirm={() => {
            const target = revoking;
            setRevoking(undefined);
            void run(() =>
              api.command('POST', `${connectionPath(base, target.id)}/revoke`, undefined, {
                ifMatch: target.version,
              }),
            );
          }}
          onCancel={() => setRevoking(undefined)}
        />
      ) : null}

      {replacing ? (
        <form
          style={formStyle}
          noValidate
          data-testid="connection-replace-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (replaceKey.trim().length < 4 || replaceSecret.length < 1) return;
            const target = replacing;
            const credential = { keyId: replaceKey.trim(), secret: replaceSecret };
            setReplacing(undefined);
            setReplaceKey('');
            setReplaceSecret('');
            void run(() =>
              api.command('PUT', `${connectionPath(base, target.id)}/credential`, credential, {
                ifMatch: target.version,
                idempotent: false,
              }),
            );
          }}
        >
          <h2>{f.t('replaceTitle', { name: replacing.name })}</h2>
          <p style={mutedStyle}>{f.t('create.readOnlyNotice')}</p>
          <Field label={f.t('create.keyId')}>
            {(p) => (
              <input
                {...p}
                value={replaceKey}
                autoComplete="off"
                style={inputStyle}
                onChange={(e) => setReplaceKey(e.target.value)}
              />
            )}
          </Field>
          <Field label={f.t('create.secret')} hint={f.t('create.secretHint')}>
            {(p) => (
              <input
                {...p}
                type="password"
                value={replaceSecret}
                autoComplete="new-password"
                style={inputStyle}
                onChange={(e) => setReplaceSecret(e.target.value)}
              />
            )}
          </Field>
          <div style={rowStyle}>
            <button type="submit" disabled={busy}>
              {f.t('replace')}
            </button>
            <button type="button" onClick={() => setReplacing(undefined)}>
              {f.t('keep')}
            </button>
          </div>
        </form>
      ) : null}

      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : items.length === 0 ? (
        <p style={mutedStyle} data-testid="connections-empty">
          {f.t('empty')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          {items.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              provider={providerOf(c.providerId)}
              f={f}
              accounts={accounts}
              canManage={canManage}
              canSyncRole={ctx.canEdit}
              busy={busy}
              onSync={(conn, from) =>
                void run(async () => {
                  const r = await api.command<{ importJobId: string }>(
                    'POST',
                    `${connectionPath(base, conn.id)}/sync`,
                    from ? { from } : {},
                  );
                  if (r.data) window.location.assign(ctx.href(`/imports/${r.data.importJobId}`));
                })
              }
              onReplace={setReplacing}
              onRevoke={setRevoking}
              onUpload={(conn, file) =>
                void run(async () => {
                  const outcome = await uploadStatementDocument({
                    api,
                    base,
                    file,
                    onPhase: () => undefined,
                  });
                  if (outcome.kind === 'rejected') throw new Error('rejected');
                  const r = await api.command<{ id: string }>('POST', `${base}/imports`, {
                    connectionId: conn.id,
                    documentId: outcome.document.id,
                  });
                  if (r.data) window.location.assign(ctx.href(`/imports/${r.data.id}`));
                })
              }
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <ConnectionForm
          f={f}
          providers={selectableProviders(providers)}
          accounts={accounts}
          busy={busy}
          onSubmit={(draft, needsCredential) =>
            void run(() =>
              api.command('POST', connectionsPath(base), createConnectionBody(draft, needsCredential)),
            )
          }
        />
      ) : (
        <p style={mutedStyle} data-testid="connections-viewer-note">
          {f.t('ownerOnly')}
        </p>
      )}
    </section>
  );
}
