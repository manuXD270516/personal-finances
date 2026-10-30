'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemMessage } from '../../errors/error-messages';
import { ConfirmPanel, mutedStyle, pageStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { BFF_API, useSession } from '../session-context';
import {
  EMPTY_MAPPING_FORM,
  POLL_MS,
  buildMapping,
  fileAlreadyImported,
  importPath,
  importsPath,
  initialMappingOf,
  isCancellable,
  isPolling,
  mappingFormOf,
  stepOf,
  type MappingErrors,
  type MappingForm,
  type WizardStep,
} from './logic';
import { FileInfo } from './FileInfo';
import { MappingStep } from './MappingStep';
import { ReviewStep } from './ReviewStep';
import { AlreadyImportedWarning, ResultStep } from './ResultPanels';
import { StepIndicator } from './StepIndicator';
import { UploadStep } from './UploadStep';
import { useAccounts } from './useAccounts';
import type { ImportCreated, ImportJob, ImportMapped, ImportPreviewSummary } from './types';
import { AttachmentsSection } from '../documents/AttachmentsSection';
import { reasonKey } from '../documents/logic';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { DocumentUploadStep } from './DocumentUploadStep';
import { MappingHelp, SaveAsProfile } from './MappingHelp';
import { ParseFailedPanel, ProcessingPanel } from './ProcessingPanel';
import { RevertPanel } from './RevertPanel';
import { uploadStatementDocument, type UploadPhase } from './document-upload';
import {
  canRevert,
  createFromDocumentBody,
  listProfilesPath,
  profilesPath,
  qifDateOrderBody,
  reconciliationHref,
  type DateOrder,
} from './pipeline-logic';
import type { ImportProfile, ImportProfileCandidate, ImportProfilePage } from './types';

const STEP_TITLE_KEY: Readonly<Record<WizardStep, string>> = {
  1: 'steps.upload',
  2: 'steps.mapping',
  3: 'steps.review',
  4: 'steps.result',
};

/** `/imports/nueva`: asistente desde el paso 1 (la cuenta puede venir preseleccionada con `?cuenta=`). */
export function NewImportPage({ accountId }: { accountId?: string | undefined }) {
  return <WithWorkspace>{(ctx) => <ImportWizard ctx={ctx} accountId={accountId} />}</WithWorkspace>;
}

/** `/imports/{importId}`: retoma el asistente en el paso que corresponde al estado de la importación. */
export function ImportDetailPage({ importId }: { importId: string }) {
  return <WithWorkspace>{(ctx) => <ImportWizard ctx={ctx} importId={importId} />}</WithWorkspace>;
}

/**
 * Asistente "Importar CSV" de 4 pasos (openspec add-basic-csv-import 6.1; docs/28 §4.7): Archivo → Columnas → Revisar →
 * Resultado. El paso sale del estado de la importación; al cambiar de paso el foco pasa al encabezado del paso. Sin
 * categoría ni fusión (Phase 3): las transacciones quedan "sin categoría" y se categorizan después en lote.
 */
export function ImportWizard({
  ctx,
  importId,
  accountId,
}: {
  ctx: WorkspaceContext;
  importId?: string | undefined;
  accountId?: string | undefined;
}) {
  const f = useFormat('Imports', ctx);
  const { state } = useSession();
  const csrf = state.status === 'ready' ? state.csrfToken : '';
  const accounts = useAccounts(ctx);
  const [job, setJob] = useState<ImportJob | undefined>();
  const [created, setCreated] = useState<ImportCreated | undefined>();
  const [summary, setSummary] = useState<ImportPreviewSummary | undefined>();
  const [form, setForm] = useState<MappingForm>(EMPTY_MAPPING_FORM);
  const [errors, setErrors] = useState<MappingErrors>({});
  const [editingMapping, setEditingMapping] = useState(false);
  const [loading, setLoading] = useState(importId !== undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reviewRev, setReviewRev] = useState(0);
  const [tick, setTick] = useState(0);
  const td = useTranslations('Documents');
  const [phase, setPhase] = useState<{ phase: UploadPhase; percent: number } | undefined>();
  const [profiles, setProfiles] = useState<readonly ImportProfile[]>([]);
  const [saveProfile, setSaveProfile] = useState({ enabled: false, name: '' });
  const [profileNote, setProfileNote] = useState<'saved' | undefined>();
  const [showLegacy, setShowLegacy] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const etag = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  // Carga de una importación existente (retomar).
  useEffect(() => {
    if (!importId) return;
    let cancelled = false;
    ctx.api
      .get<ImportJob>(importPath(ctx.base, importId))
      .then((r) => {
        if (cancelled || !r.data) return;
        etag.current = r.etag;
        setJob(r.data);
        setForm(mappingFormOf(r.data.mapping));
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, importId]);

  // Perfiles vigentes (opcionales en la subida): un fallo no bloquea la importación.
  useEffect(() => {
    if (importId || !ctx.canEdit) return;
    let cancelled = false;
    ctx.api
      .get<ImportProfilePage>(listProfilesPath(ctx.base))
      .then((r) => {
        if (!cancelled) setProfiles(r.data?.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, ctx.canEdit, importId]);

  const viewStep: WizardStep = job ? (editingMapping ? 2 : stepOf(job.status)) : 1;

  // El foco pasa al encabezado del paso cuando cambia (no en la primera pintura).
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [viewStep]);

  // Persistencia en segundo plano: consulta cada POLL_MS con If-None-Match (304 = sin cambios).
  useEffect(() => {
    if (!job || !isPolling(job.status)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      ctx.api
        .get<ImportJob>(importPath(ctx.base, job.id), etag.current ? { etag: etag.current } : {})
        .then((r) => {
          if (cancelled) return;
          if (r.etag) etag.current = r.etag;
          if (r.data) setJob(r.data);
          else setTick((n) => n + 1);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setProblem(problemOf(err));
          // Un fallo transitorio no corta el seguimiento; uno definitivo (no existe, sin permiso) sí.
          if (!(err instanceof FinanceApiError) || err.status >= 500 || err.status === 429)
            setTick((n) => n + 1);
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ctx.api, ctx.base, job, tick]);

  const resync = useCallback(async () => {
    if (!job) return;
    try {
      const r = await ctx.api.get<ImportJob>(importPath(ctx.base, job.id));
      if (r.data) setJob(r.data);
    } catch {
      /* el error original ya se muestra */
    }
  }, [ctx.api, ctx.base, job]);

  async function upload(input: { file: File; accountId: string }) {
    setBusy(true);
    setProblem(undefined);
    try {
      const body = new FormData();
      body.append('accountId', input.accountId);
      body.append('file', input.file, input.file.name);
      const res = await fetch(`${BFF_API}${importsPath(ctx.base)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf, 'idempotency-key': uuidv7() },
        body,
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const body = json as ApiProblemBody;
        setProblem(res.status === 413 && !body.code ? { code: 'UPLOAD_TOO_LARGE' } : body);
        return;
      }
      etag.current = res.headers.get('etag') ?? undefined;
      const next = json as ImportCreated;
      setCreated(next);
      setJob(next);
      setForm(initialMappingOf(next));
      setErrors({});
    } catch {
      setProblem({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      setBusy(false);
    }
  }

  /** Sube el extracto como documento (`IMPORT_SOURCE`) y crea la importación con su `documentId`. */
  async function uploadDocument(input: { file: File; accountId: string; mappingProfileId?: string }) {
    setBusy(true);
    setProblem(undefined);
    try {
      const outcome = await uploadStatementDocument({
        api: ctx.api,
        base: ctx.base,
        file: input.file,
        onPhase: (p, percent) => setPhase({ phase: p, percent: percent ?? 0 }),
      });
      if (outcome.kind === 'rejected') {
        setProblem({
          code: 'VALIDATION_FAILED',
          detail: td(reasonKey(outcome.document.rejectionReason)),
        });
        return;
      }
      const r = await ctx.api.command<ImportJob>(
        'POST',
        importsPath(ctx.base),
        createFromDocumentBody({
          accountId: input.accountId,
          documentId: outcome.document.id,
          mappingProfileId: input.mappingProfileId,
        }),
      );
      if (r.data) {
        etag.current = r.etag;
        setJob(r.data);
        setErrors({});
      }
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setPhase(undefined);
      setBusy(false);
    }
  }

  /** `PUT .../mapping` con un cuerpo cualquiera (mapeo, perfil guardado u opciones de QIF). */
  async function putMapping(body: unknown) {
    if (!job) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ImportMapped | ImportJob>(
        'PUT',
        `${importPath(ctx.base, job.id)}/mapping`,
        body,
        { ifMatch: job.version },
      );
      if (r.data) {
        const { previewSummary, ...next } = r.data as ImportMapped;
        etag.current = r.etag;
        setJob(next);
        setSummary(previewSummary);
        setEditingMapping(false);
        setReviewRev((n) => n + 1);
      }
      return true;
    } catch (err) {
      setProblem(problemOf(err));
      if (err instanceof FinanceApiError && err.status === 412) await resync();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const applyProfile = (c: ImportProfileCandidate) =>
    void putMapping({ mappingProfileId: c.profileId, version: c.version });
  const applyQifOrder = (order: DateOrder) => void putMapping(qifDateOrderBody(order));

  async function saveAsProfile(importJobId: string) {
    try {
      await ctx.api.command('POST', profilesPath(ctx.base), {
        fromImportId: importJobId,
        name: saveProfile.name.trim(),
      });
      setProfileNote('saved');
    } catch (err) {
      setProblem(problemOf(err));
    }
  }

  async function applyMapping() {
    if (!job) return;
    const built = buildMapping(form, job.columnCount);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ImportMapped>(
        'PUT',
        `${importPath(ctx.base, job.id)}/mapping`,
        built.mapping,
        {
          ifMatch: job.version,
        },
      );
      if (r.data) {
        const { previewSummary, ...next } = r.data;
        etag.current = r.etag;
        setJob(next);
        setSummary(previewSummary);
        setEditingMapping(false);
        setReviewRev((n) => n + 1);
        if (saveProfile.enabled && saveProfile.name.trim() !== '') await saveAsProfile(job.id);
      }
    } catch (err) {
      setProblem(problemOf(err));
      if (err instanceof FinanceApiError && err.status === 412) await resync();
    } finally {
      setBusy(false);
    }
  }

  /** Acción de una sola llamada sobre la importación (cancelar, reintentar, aceptar el resultado parcial). */
  async function act(action: 'cancel' | 'retry' | 'accept-errors') {
    if (!job) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ImportJob>(
        'POST',
        `${importPath(ctx.base, job.id)}/${action}`,
        undefined,
      );
      if (r.data) {
        etag.current = r.etag;
        setJob(r.data);
      }
      setConfirmCancel(false);
    } catch (err) {
      setConfirmCancel(false);
      setProblem(problemOf(err));
      await resync();
    } finally {
      setBusy(false);
    }
  }

  function editMapping() {
    if (!job) return;
    setForm(mappingFormOf(job.mapping));
    setErrors({});
    setEditingMapping(true);
  }

  if (loading) {
    return (
      <p aria-busy="true" data-testid="import-loading">
        {f.t('loading')}
      </p>
    );
  }

  const accountName = job ? (accounts.byId(job.accountId)?.name ?? '—') : undefined;
  const warning = job ? fileAlreadyImported(job) : undefined;
  const cancelButton =
    job && ctx.canEdit && isCancellable(job.status) ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmCancel(true)}
        data-testid="import-cancel"
      >
        {f.t('cancel.button')}
      </button>
    ) : null;

  return (
    <section
      aria-labelledby="import-title"
      style={pageStyle}
      data-testid="import-wizard"
      data-step={viewStep}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/imports')}>{f.t('backToList')}</a>
      </p>
      <h1 id="import-title">{f.t('title')}</h1>
      <StepIndicator current={viewStep} f={f} />
      <h2 ref={headingRef} tabIndex={-1} data-testid="import-step-heading">
        {f.t('steps.heading', { n: viewStep, title: f.t(STEP_TITLE_KEY[viewStep]) })}
      </h2>

      {job ? <FileInfo job={job} f={f} accountName={accountName} /> : null}

      {warning ? (
        <AlreadyImportedWarning
          warning={warning}
          f={f}
          href={ctx.href(`/imports/${warning.previousImportId}`)}
        />
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      {confirmCancel ? (
        <ConfirmPanel
          testId="import-cancel-confirm"
          title={f.t('cancel.title')}
          description={f.t('cancel.description')}
          confirmLabel={f.t('cancel.confirm')}
          cancelLabel={f.t('cancel.keep')}
          busy={busy}
          onConfirm={() => void act('cancel')}
          onCancel={() => setConfirmCancel(false)}
        />
      ) : null}

      {viewStep === 1 ? (
        job ? null : ctx.canEdit ? (
          !accounts.loaded ? (
            <p aria-busy="true">{f.t('loading')}</p>
          ) : (
            <>
              <DocumentUploadStep
                f={f}
                accounts={accounts.active}
                profiles={profiles}
                initialAccountId={accountId}
                busy={busy}
                phase={phase?.phase}
                percent={phase?.percent ?? 0}
                onSubmit={(input) => void uploadDocument(input)}
              />
              <details open={showLegacy} onToggle={(e) => setShowLegacy(e.currentTarget.open)}>
                <summary data-testid="import-legacy-toggle">{f.t('legacy.summary')}</summary>
                <p style={mutedStyle} data-testid="import-legacy-note">
                  {f.t('legacy.note')}
                </p>
                <UploadStep
                  f={f}
                  accounts={accounts.active}
                  initialAccountId={accountId}
                  busy={busy}
                  testPrefix="import-legacy"
                  onSubmit={(input) => void upload(input)}
                />
              </details>
            </>
          )
        ) : (
          <p style={mutedStyle} data-testid="import-viewer-note">
            {f.t('viewerNotice')}
          </p>
        )
      ) : null}

      {job && viewStep === 1 && (job.status === 'UPLOADED' || job.status === 'PROCESSING') ? (
        <>
          <ProcessingPanel job={job} f={f} />
          {cancelButton}
        </>
      ) : null}
      {job && viewStep === 1 && job.status === 'PARSE_FAILED' ? (
        <ParseFailedPanel
          job={job}
          f={f}
          message={(code) => problemMessage({ code }, ctx.uiLocale)}
          newHref={ctx.href(`/imports/nueva?cuenta=${job.accountId}`)}
        />
      ) : null}

      {job && viewStep === 2 ? (
        <MappingHelp
          job={job}
          f={f}
          busy={busy}
          canEdit={ctx.canEdit}
          onApplyProfile={applyProfile}
          onQifDateOrder={applyQifOrder}
        />
      ) : null}
      {job && viewStep === 2 && ctx.canEdit ? (
        <SaveAsProfile
          f={f}
          enabled={saveProfile.enabled}
          name={saveProfile.name}
          disabled={busy}
          onChange={(patch) => setSaveProfile((prev) => ({ ...prev, ...patch }))}
        />
      ) : null}
      {job && viewStep === 2 ? (
        <MappingStep
          f={f}
          header={job.header}
          sampleRows={created?.sampleRows}
          columnCount={job.columnCount}
          form={form}
          errors={errors}
          busy={busy}
          canEdit={ctx.canEdit}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          onApply={() => void applyMapping()}
        >
          {editingMapping ? (
            <button type="button" disabled={busy} onClick={() => setEditingMapping(false)}>
              {f.t('mapping.backToReview')}
            </button>
          ) : null}
          {cancelButton}
        </MappingStep>
      ) : null}

      {job && viewStep === 3 ? (
        <ReviewStep
          key={reviewRev}
          ctx={ctx}
          f={f}
          job={job}
          initialSummary={summary}
          onJobChange={setJob}
          onApproved={(approved) => {
            setProblem(undefined);
            setJob(approved);
          }}
          actions={
            <>
              {ctx.canEdit ? (
                <button type="button" disabled={busy} onClick={editMapping} data-testid="import-edit-mapping">
                  {f.t('review.editMapping')}
                </button>
              ) : null}
              {cancelButton}
            </>
          }
        />
      ) : null}

      {job && viewStep === 4 ? (
        <ResultStep
          job={job}
          f={f}
          canEdit={ctx.canEdit}
          busy={busy}
          messageOf={(code) => problemMessage({ code }, ctx.uiLocale)}
          transactionsHref={ctx.href(`/transacciones?cuenta=${job.accountId}`)}
          newHref={ctx.href(`/imports/nueva?cuenta=${job.accountId}`)}
          listHref={ctx.href('/imports')}
          onRetry={() => void act('retry')}
          onAccept={() => void act('accept-errors')}
          reconcileHref={
            job.reconciliationOffer ? reconciliationHref(ctx.href, job.reconciliationOffer) : undefined
          }
          extras={
            <>
              {canRevert(job.status, ctx.canEdit) ? (
                <RevertPanel ctx={ctx} f={f} job={job} onJobChange={setJob} />
              ) : null}
              {job.documentId ? (
                <details open={showTimeline} onToggle={(e) => setShowTimeline(e.currentTarget.open)}>
                  <summary data-testid="import-timeline-toggle">{f.t('timeline.summary')}</summary>
                  {showTimeline ? (
                    <LifecycleTab
                      ctx={ctx}
                      path={`imports/${job.id}`}
                      refreshKey={job.version}
                      stateLabel={(code) => (f.has(`status.${code}`) ? f.t(`status.${code}`) : code)}
                      accountName={(id) => accounts.byId(id)?.name}
                      idPrefix="import-lifecycle"
                    />
                  ) : null}
                </details>
              ) : null}
            </>
          }
        />
      ) : null}
      {profileNote === 'saved' ? (
        <p role="status" data-testid="profile-saved">
          {f.t('saveProfile.saved')}
        </p>
      ) : null}
      {job ? <AttachmentsSection targetType="IMPORT_JOB" targetId={job.id} purpose="IMPORT_SOURCE" /> : null}
    </section>
  );
}
