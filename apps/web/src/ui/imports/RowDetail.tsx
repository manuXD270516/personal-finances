'use client';

import { useState } from 'react';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { formatBusinessDate } from '../planning/logic';
import { Field, errorStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { categoryOptions, type Catalogs } from '../transactions/catalogs';
import {
  CONFIDENCE_PRESENTATION,
  EMPTY_CONVERSION_FORM,
  SIGNAL_KEYS,
  buildConversion,
  candidatesOf,
  effectiveField,
  effectiveRatePreview,
  isLowConfidence,
  isPreselectedLink,
  linkedCandidate,
  originKey,
  rowKindOf,
  type ConversionForm,
  type EditableField,
} from './pipeline-logic';
import { candidateKindKey } from './logic';
import type {
  FieldOrigin,
  ImportDuplicateCandidate,
  ImportJob,
  ImportPreviewRow,
  ImportRowConversion,
  ImportRowKind,
} from './types';

/** Cambios que una fila admite en `PATCH .../rows/{id}` (todos opcionales; el servidor exige al menos uno). */
export interface RowPatch {
  readonly kind?: ImportRowKind;
  readonly categoryId?: string | null;
  readonly counterpartyId?: string | null;
  readonly description?: string | null;
  readonly note?: string | null;
  readonly transfer?: { counterAccountId: string } | null;
  readonly conversion?: ImportRowConversion | null;
  readonly occurrenceLink?: { occurrenceId: string } | null;
}

/** ¿La fila trae datos del pipeline de documentos (propuesta, candidatos con puntaje, compromisos…)? */
export function hasPipelineData(row: ImportPreviewRow): boolean {
  return (
    (row.proposal ?? null) !== null ||
    (row.edits ?? null) !== null ||
    (row.candidates?.length ?? 0) > 0 ||
    (row.occurrenceCandidates?.length ?? 0) > 0 ||
    (row.transfer ?? null) !== null ||
    (row.conversion ?? null) !== null ||
    (row.duplicateOfRow ?? null) !== null
  );
}

function OriginValue({
  f,
  row,
  field,
  names,
}: {
  f: FormatContext;
  row: ImportPreviewRow;
  field: EditableField;
  names: (id: string) => string | undefined;
}) {
  const v = effectiveField(row, field);
  if (!v || v.value === null || v.value === '') return <span style={mutedStyle}>{f.t('detail.none')}</span>;
  const raw = Array.isArray(v.value) ? v.value.map((x) => names(x) ?? x).join(', ') : String(v.value);
  const text = field === 'description' ? raw : (names(String(v.value)) ?? raw);
  return (
    <>
      {text}{' '}
      <span style={mutedStyle} data-testid={`origin-${field}`} data-origin={v.origin ?? ''}>
        ({f.t(originKey(v.origin))}
        {v.origin === 'RULE' && v.ruleId
          ? ` · ${f.t('detail.ruleRef', { id: v.ruleId.slice(0, 8), version: v.ruleVersion ?? 0 })}`
          : ''}
        )
      </span>
    </>
  );
}

/** Candidato de duplicado con su puntaje, confianza y las cinco señales que lo componen (descripción como texto). */
export function CandidateWithScore({
  candidate,
  f,
  linked,
}: {
  candidate: ImportDuplicateCandidate;
  f: FormatContext;
  linked: boolean;
}) {
  return (
    <li
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="import-candidate-scored"
      data-confidence={candidate.confidence}
      data-linked={linked}
    >
      <p style={{ margin: 0 }}>
        <Badge
          presentation={CONFIDENCE_PRESENTATION[candidate.confidence]}
          label={f.t(`confidence.${candidate.confidence}`)}
          status={candidate.confidence}
          testId="candidate-confidence"
        />{' '}
        <strong data-testid="candidate-score">{f.t('detail.score', { score: candidate.score })}</strong>
        {' · '}
        {candidate.date ? formatBusinessDate(candidate.date) : f.t('candidate.noDate')}
        {' · '}
        {candidate.amount ? formatMoney(candidate.amount, f.locale) : f.t('candidate.noAmount')}
        {' · '}
        {f.t(candidateKindKey(candidate.kind))}
        {linked ? (
          <>
            {' · '}
            <strong>{candidate.preselected ? f.t('detail.preselected') : f.t('detail.linked')}</strong>
          </>
        ) : null}
      </p>
      {candidate.description ? <p style={{ ...mutedStyle, margin: 0 }}>{candidate.description}</p> : null}
      <p style={{ ...mutedStyle, margin: 0 }} data-testid="candidate-signals">
        {SIGNAL_KEYS.map((k) => `${f.t(`detail.signal.${k}`)} ${candidate.signals[k]}`).join(' · ')}
      </p>
    </li>
  );
}

/**
 * Detalle ampliado de una fila del pipeline (openspec add-import-pipeline, tarea 7.2): origen por campo (regla y versión),
 * candidatos de duplicado con puntaje y señales, aviso de confianza baja, coincidencias con compromisos (confirmar o
 * quitar), y —para quien escribe— el editor de la fila: descripción, nota, categoría, contraparte, transferencia y
 * conversión. Toda edición exige la versión vigente del import; no crea ninguna transacción.
 */
export function RowDetail({
  row,
  f,
  job,
  canEdit,
  catalogs,
  accountId,
  accountCurrency,
  busy,
  error,
  onEdit,
}: {
  row: ImportPreviewRow;
  f: FormatContext;
  job: Pick<ImportJob, 'status'>;
  canEdit: boolean;
  catalogs: Catalogs;
  accountId: string;
  accountCurrency: string;
  busy: boolean;
  /** Texto traducido del último error de edición de ESTA fila. */
  error?: string | undefined;
  onEdit: (row: ImportPreviewRow, patch: RowPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const editable = canEdit && job.status === 'AWAITING_REVIEW' && row.classification !== 'INVALID';
  const candidates = candidatesOf(row);
  const linked = linkedCandidate(row);
  const kind = rowKindOf(row);
  const occ = row.occurrenceCandidates ?? [];

  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="row-detail"
      data-line={row.lineNumber}
    >
      {row.proposal?.excluded ? (
        <p style={{ ...warningStyle, margin: 0 }} data-testid="row-rule-excluded">
          {f.t('detail.ruleExcluded')}
        </p>
      ) : null}
      {row.proposal || row.edits ? (
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--pf-space-1)' }} data-testid="row-origins">
          <div>
            <dt style={mutedStyle}>{f.t('detail.kind')}</dt>
            <dd style={{ margin: 0 }} data-testid="row-kind" data-kind={kind}>
              {f.t(`detail.kinds.${kind}`)}
              {row.transfer ? ` → ${catalogs.names.account(row.transfer.counterAccountId) ?? '—'}` : ''}
              {row.conversion ? ` → ${catalogs.names.account(row.conversion.counterAccountId) ?? '—'}` : ''}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('detail.category')}</dt>
            <dd style={{ margin: 0 }}>
              <OriginValue f={f} row={row} field="categoryId" names={catalogs.names.category} />
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('detail.counterparty')}</dt>
            <dd style={{ margin: 0 }}>
              <OriginValue f={f} row={row} field="counterpartyId" names={catalogs.names.counterparty} />
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('detail.description')}</dt>
            <dd style={{ margin: 0 }}>
              <OriginValue f={f} row={row} field="description" names={() => undefined} />
            </dd>
          </div>
        </dl>
      ) : null}

      {(row.duplicateOfRow ?? null) !== null ? (
        <p style={{ ...mutedStyle, margin: 0 }} data-testid="row-duplicate-of">
          {f.t('detail.duplicateOfRow', { line: row.duplicateOfRow ?? 0 })}
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <div>
          {isLowConfidence(row) ? (
            <p style={{ ...warningStyle, margin: 0 }} data-testid="row-low-confidence">
              {f.t('detail.lowConfidence')}
            </p>
          ) : null}
          {isPreselectedLink(row) ? (
            <p style={{ margin: 0 }} role="note" data-testid="row-preselected-note">
              {f.t('detail.preselectedNote')}
            </p>
          ) : null}
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: 'var(--pf-space-2)' }}>
            {candidates.map((c) => (
              <CandidateWithScore
                key={c.transactionId}
                candidate={c}
                f={f}
                linked={row.decision === 'SKIP' && linked?.transactionId === c.transactionId}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {occ.length > 0 ? (
        <div data-testid="row-occurrences">
          <p style={{ margin: 0 }}>
            <strong>{f.t('detail.commitments')}</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: 'var(--pf-space-1)' }}>
            {occ.map((o) => {
              const confirmed = row.occurrenceLink?.occurrenceId === o.occurrenceId;
              return (
                <li key={o.occurrenceId} data-testid="row-occurrence" data-confirmed={confirmed}>
                  <Badge
                    presentation={CONFIDENCE_PRESENTATION[o.confidence]}
                    label={f.t(`confidence.${o.confidence}`)}
                    status={o.confidence}
                    testId="occurrence-confidence"
                  />{' '}
                  {o.label} · {formatBusinessDate(o.dueDate)}
                  {o.expectedAmount ? ` · ${formatMoney(o.expectedAmount, f.locale)}` : ''}{' '}
                  {confirmed ? <strong>{f.t('detail.confirmed')}</strong> : null}
                  {editable ? (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid={confirmed ? 'occurrence-unlink' : 'occurrence-confirm'}
                      aria-label={
                        confirmed
                          ? f.t('detail.unlinkAria', { line: row.lineNumber, name: o.label })
                          : f.t('detail.confirmAria', { line: row.lineNumber, name: o.label })
                      }
                      onClick={() =>
                        onEdit(row, { occurrenceLink: confirmed ? null : { occurrenceId: o.occurrenceId } })
                      }
                    >
                      {confirmed ? f.t('detail.unlink') : f.t('detail.confirm')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p style={{ ...mutedStyle, margin: 0 }}>{f.t('detail.commitmentsNote')}</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={errorStyle} data-testid="row-edit-error">
          {error}
        </p>
      ) : null}

      {editable ? (
        <div>
          <button
            type="button"
            aria-expanded={open}
            data-testid="row-edit-toggle"
            aria-label={f.t('detail.editAria', { line: row.lineNumber })}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? f.t('detail.closeEditor') : f.t('detail.edit')}
          </button>
          {open ? (
            <RowEditor
              row={row}
              f={f}
              catalogs={catalogs}
              accountId={accountId}
              accountCurrency={accountCurrency}
              busy={busy}
              onEdit={onEdit}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RowEditor({
  row,
  f,
  catalogs,
  accountId,
  accountCurrency,
  busy,
  onEdit,
}: {
  row: ImportPreviewRow;
  f: FormatContext;
  catalogs: Catalogs;
  accountId: string;
  accountCurrency: string;
  busy: boolean;
  onEdit: (row: ImportPreviewRow, patch: RowPatch) => void;
}) {
  const direction = row.direction ?? 'OUT';
  const [description, setDescription] = useState(row.edits?.description ?? row.description ?? '');
  const [note, setNote] = useState(row.edits?.note ?? '');
  const catEdit = effectiveField(row, 'categoryId');
  const [categoryId, setCategoryId] = useState(typeof catEdit?.value === 'string' ? catEdit.value : '');
  const cpEdit = effectiveField(row, 'counterpartyId');
  const [counterpartyId, setCounterpartyId] = useState(typeof cpEdit?.value === 'string' ? cpEdit.value : '');
  const [mode, setMode] = useState<'PLAIN' | 'TRANSFER' | 'CONVERSION'>(
    row.conversion ? 'CONVERSION' : row.transfer ? 'TRANSFER' : 'PLAIN',
  );
  const [counterAccount, setCounterAccount] = useState(
    row.transfer?.counterAccountId ?? row.conversion?.counterAccountId ?? '',
  );
  const [conversion, setConversion] = useState<ConversionForm>(
    row.conversion
      ? {
          counterAccountId: row.conversion.counterAccountId,
          counterAmount: row.conversion.counterAmount.amount,
          fee: row.conversion.fee?.amount ?? '',
          quotedRate: row.conversion.quotedRate ?? '',
        }
      : EMPTY_CONVERSION_FORM,
  );
  const [conversionErrors, setConversionErrors] = useState<Record<string, true>>({});

  const options = categoryOptions(
    catalogs.categories,
    catalogs.groups,
    direction === 'OUT' ? 'EXPENSE' : 'INCOME',
  );
  const others = catalogs.activeAccounts.filter((a) => a.id !== accountId);
  const counterCurrency = others.find(
    (a) => a.id === (mode === 'CONVERSION' ? conversion.counterAccountId : counterAccount),
  )?.currency;
  const rate =
    mode === 'CONVERSION' && row.amount
      ? effectiveRatePreview(row.amount.amount, conversion.counterAmount)
      : null;

  function saveFields() {
    onEdit(row, {
      description: description.trim() === '' ? null : description,
      note: note.trim() === '' ? null : note,
      categoryId: categoryId === '' ? null : categoryId,
      counterpartyId: counterpartyId === '' ? null : counterpartyId,
    });
  }

  function saveMovement() {
    if (mode === 'PLAIN') {
      onEdit(row, { kind: direction === 'OUT' ? 'EXPENSE' : 'INCOME' });
    } else if (mode === 'TRANSFER') {
      if (counterAccount === '') {
        setConversionErrors({ account: true });
        return;
      }
      setConversionErrors({});
      onEdit(row, { transfer: { counterAccountId: counterAccount } });
    } else {
      const built = buildConversion(conversion, { counterCurrency, rowCurrency: accountCurrency });
      if (!built.ok) {
        setConversionErrors(built.errors);
        return;
      }
      setConversionErrors({});
      onEdit(row, { conversion: built.body });
    }
  }

  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-3)', marginTop: 'var(--pf-space-2)' }}
      data-testid="row-editor"
    >
      <fieldset style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('editor.fields')}</legend>
        <Field label={f.t('editor.description')}>
          {(p) => (
            <input
              {...p}
              type="text"
              maxLength={500}
              style={inputStyle}
              value={description}
              data-testid="editor-description"
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('editor.note')}>
          {(p) => (
            <input
              {...p}
              type="text"
              maxLength={2000}
              style={inputStyle}
              value={note}
              data-testid="editor-note"
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div style={rowStyle}>
          <Field label={f.t('editor.category')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={categoryId}
                data-testid="editor-category"
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{f.t('editor.noCategory')}</option>
                {options.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </Field>
          <Field label={f.t('editor.counterparty')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={counterpartyId}
                data-testid="editor-counterparty"
                onChange={(e) => setCounterpartyId(e.target.value)}
              >
                <option value="">{f.t('editor.noCounterparty')}</option>
                {catalogs.counterparties
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
        <div>
          <button type="button" disabled={busy} data-testid="editor-save-fields" onClick={saveFields}>
            {f.t('editor.saveFields')}
          </button>
        </div>
      </fieldset>

      <fieldset style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('editor.movement')}</legend>
        <Field label={f.t('editor.movementKind')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={mode}
              data-testid="editor-kind"
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="PLAIN">
                {direction === 'OUT' ? f.t('detail.kinds.EXPENSE') : f.t('detail.kinds.INCOME')}
              </option>
              <option value="TRANSFER">{f.t('detail.kinds.TRANSFER')}</option>
              <option value="CONVERSION">{f.t('detail.kinds.CONVERSION')}</option>
            </select>
          )}
        </Field>
        {mode === 'TRANSFER' ? (
          <Field
            label={f.t(direction === 'OUT' ? 'editor.transferTo' : 'editor.transferFrom')}
            hint={f.t('editor.transferHint', { currency: accountCurrency })}
            error={conversionErrors['account'] ? f.t('editor.errors.account') : undefined}
          >
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={counterAccount}
                data-testid="editor-counter-account"
                onChange={(e) => setCounterAccount(e.target.value)}
              >
                <option value="">{f.t('upload.accountPlaceholder')}</option>
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {mode === 'CONVERSION' ? (
          <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
            <Field
              label={f.t(direction === 'OUT' ? 'editor.transferTo' : 'editor.transferFrom')}
              error={conversionErrors['account'] ? f.t('editor.errors.account') : undefined}
            >
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={conversion.counterAccountId}
                  data-testid="editor-conv-account"
                  onChange={(e) => setConversion({ ...conversion, counterAccountId: e.target.value })}
                >
                  <option value="">{f.t('upload.accountPlaceholder')}</option>
                  {others
                    .filter((a) => a.currency !== accountCurrency)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field
              label={f.t('editor.counterAmount', { currency: counterCurrency ?? '—' })}
              error={conversionErrors['amount'] ? f.t('editor.errors.amount') : undefined}
              hint={rate ? f.t('editor.ratePreview', { rate }) : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="decimal"
                  style={inputStyle}
                  value={conversion.counterAmount}
                  data-testid="editor-conv-amount"
                  onChange={(e) => setConversion({ ...conversion, counterAmount: e.target.value })}
                />
              )}
            </Field>
            <div style={rowStyle}>
              <Field
                label={f.t('editor.fee', { currency: accountCurrency })}
                error={conversionErrors['fee'] ? f.t('editor.errors.amount') : undefined}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="decimal"
                    style={inputStyle}
                    value={conversion.fee}
                    data-testid="editor-conv-fee"
                    onChange={(e) => setConversion({ ...conversion, fee: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={f.t('editor.quotedRate')}
                error={conversionErrors['rate'] ? f.t('editor.errors.amount') : undefined}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="decimal"
                    style={inputStyle}
                    value={conversion.quotedRate}
                    data-testid="editor-conv-rate"
                    onChange={(e) => setConversion({ ...conversion, quotedRate: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <p style={{ ...mutedStyle, margin: 0 }}>{f.t('editor.conversionNote')}</p>
          </div>
        ) : null}
        <div>
          <button type="button" disabled={busy} data-testid="editor-save-movement" onClick={saveMovement}>
            {f.t('editor.saveMovement')}
          </button>
        </div>
      </fieldset>
    </div>
  );
}

export type { FieldOrigin };
