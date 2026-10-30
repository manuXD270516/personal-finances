'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { ConfirmPanel, cardStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import type { Institution } from '../common/types';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { groupProfilesByInstitution, listProfilesPath, profilePath } from './pipeline-logic';
import { useAccounts } from './useAccounts';
import type { ImportProfile, ImportProfilePage } from './types';

export function ImportProfilesPage() {
  return <WithWorkspace>{(ctx) => <ProfilesList ctx={ctx} />}</WithWorkspace>;
}

/** Un perfil con sus versiones; archivarlo afecta a las importaciones nuevas, no a las ya hechas. */
export function ProfileCard({
  profile,
  f,
  accountName,
  timeZone,
  canEdit,
  busy,
  onArchive,
}: {
  profile: ImportProfile;
  f: FormatContext;
  accountName: string | undefined;
  timeZone: string;
  canEdit: boolean;
  busy: boolean;
  onArchive: (profile: ImportProfile) => void;
}) {
  const archived = profile.archivedAt !== null;
  return (
    <li
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="profile-item"
      data-archived={archived}
    >
      <div style={rowStyle}>
        <strong>{profile.name}</strong>
        <span style={mutedStyle}>
          {profile.format} · v{profile.version}
          {accountName ? ` · ${f.t('profiles.ofAccount', { account: accountName })}` : ''}
        </span>
        {archived ? (
          <Badge
            presentation={{ icon: '✕', tone: 'neutral' }}
            label={f.t('profiles.archived')}
            status="ARCHIVED"
            testId="profile-archived"
          />
        ) : null}
      </div>
      <details>
        <summary data-testid="profile-versions-toggle">
          {f.t('profiles.versions', { count: profile.versions.length })}
          <span className="pf-sr-only"> {profile.name}</span>
        </summary>
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="profile-versions">
          {[...profile.versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <li key={v.version}>
                {f.t('profiles.versionItem', {
                  version: v.version,
                  date: formatInstant(v.createdAt, f.locale, timeZone),
                })}
              </li>
            ))}
        </ol>
      </details>
      {canEdit && !archived ? (
        <div>
          <button
            type="button"
            disabled={busy}
            data-testid="profile-archive"
            aria-label={f.t('profiles.archiveNamed', { name: profile.name })}
            onClick={() => onArchive(profile)}
          >
            {f.t('profiles.archive')}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function ProfilesList({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Imports', ctx);
  const accounts = useAccounts(ctx);
  const [profiles, setProfiles] = useState<readonly ImportProfile[] | undefined>();
  const [institutions, setInstitutions] = useState<ReadonlyMap<string, string>>(new Map());
  const [includeArchived, setIncludeArchived] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [archiving, setArchiving] = useState<ImportProfile | undefined>();
  const [busy, setBusy] = useState(false);
  const { api, base } = ctx;

  const load = useCallback(async () => {
    try {
      const r = await api.get<ImportProfilePage>(listProfilesPath(base, { includeArchived }));
      setProfiles(r.data?.data ?? []);
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
      setProfiles([]);
    }
  }, [api, base, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    listAll<Institution>(api, `${base}/institutions`, new URLSearchParams({ includeArchived: 'true' }))
      .then((list) => {
        if (!cancelled) setInstitutions(new Map(list.map((i) => [i.id, i.name])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, base]);

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    try {
      await api.command('POST', `${profilePath(base, archiving.id)}/archive`, undefined, {
        ifMatch: archiving.version,
      });
      setArchiving(undefined);
      await load();
    } catch (err) {
      setArchiving(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const groups = profiles ? groupProfilesByInstitution(profiles) : [];
  return (
    <section aria-labelledby="profiles-title" style={pageStyle} data-testid="import-profiles">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/imports')}>{f.t('backToList')}</a>
      </p>
      <h1 id="profiles-title">{f.t('profiles.title')}</h1>
      <p style={mutedStyle}>{f.t('profiles.intro')}</p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={includeArchived}
          data-testid="profiles-include-archived"
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        {f.t('profiles.includeArchived')}
      </label>
      {archiving ? (
        <ConfirmPanel
          testId="profile-archive-confirm"
          title={f.t('profiles.archiveTitle', { name: archiving.name })}
          description={f.t('profiles.archiveBody')}
          confirmLabel={f.t('profiles.archive')}
          cancelLabel={f.t('profiles.keep')}
          busy={busy}
          onConfirm={() => void archive()}
          onCancel={() => setArchiving(undefined)}
        />
      ) : null}
      {profiles === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : profiles.length === 0 ? (
        <p style={mutedStyle} data-testid="profiles-empty">
          {f.t('profiles.empty')}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.institutionId || 'none'} aria-labelledby={`inst-${g.institutionId || 'none'}`}>
            <h2 id={`inst-${g.institutionId || 'none'}`} data-testid="profiles-institution">
              {g.institutionId === ''
                ? f.t('profiles.noInstitution')
                : (institutions.get(g.institutionId) ?? f.t('profiles.unknownInstitution'))}
            </h2>
            <ul
              style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}
            >
              {g.profiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  f={f}
                  accountName={p.accountId ? accounts.byId(p.accountId)?.name : undefined}
                  timeZone={ctx.timeZone}
                  canEdit={ctx.canEdit}
                  busy={busy}
                  onArchive={setArchiving}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
