'use client';

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
        ctx.canEdit ? (
          !accounts.loaded ? (
            <p aria-busy="true">{f.t('loading')}</p>
          ) : (
            <UploadStep
              f={f}
              accounts={accounts.active}
              initialAccountId={accountId}
              busy={busy}
              onSubmit={(input) => void upload(input)}
            />
          )
        ) : (
          <p style={mutedStyle} data-testid="import-viewer-note">
            {f.t('viewerNotice')}
          </p>
        )
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
        />
      ) : null}
    </section>
  );
}
