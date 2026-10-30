import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { DocumentUploadStep } from './DocumentUploadStep';
import { MappingHelp, SaveAsProfile } from './MappingHelp';
import { ParseFailedPanel, ProcessingPanel } from './ProcessingPanel';
import { PreviewTable } from './PreviewTable';
import { ProfileCard } from './ProfilesPage';
import { ReconciliationResult, ResultStep, RuleCoveragePanel } from './ResultPanels';
import { AdvancedFilters, StatementPanel } from './ReviewTools';
import { RowDetail, hasPipelineData } from './RowDetail';
import { EMPTY_FILTER } from './pipeline-logic';
import type { Catalogs } from '../transactions/catalogs';
import type {
  ImportDuplicateCandidate,
  ImportJob,
  ImportPreviewRow,
  ImportPreviewSummary,
  ImportProfile,
} from './types';

const f = esContext('Imports');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noop = () => undefined;

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    accountId: 'acc-bob',
    status: 'AWAITING_REVIEW',
    originalName: 'extracto-marzo.ofx',
    fileSha256: 'a'.repeat(64),
    fileSizeBytes: 900,
    detected: { encoding: 'utf-8', delimiter: ',' },
    rowCount: 4,
    columnCount: 1,
    header: [],
    mapping: null,
    counters: {
      rows: 4,
      newRows: 3,
      alreadyImported: 0,
      probableDuplicates: 1,
      invalid: 0,
      toCreate: 3,
      skipped: 1,
      excluded: 0,
      created: 0,
      failed: 0,
    },
    progress: { attempt: 0, batchCount: 0, batchesDone: 0 },
    errors: [],
    warnings: [],
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    expiresAt: null,
    createdBy: 'u1',
    createdAt: '2026-10-20T14:00:00Z',
    updatedAt: '2026-10-20T14:00:00Z',
    version: 3,
    documentId: 'doc-1',
    format: 'OFX',
    ...over,
  };
}

const candidate = (over: Partial<ImportDuplicateCandidate> = {}): ImportDuplicateCandidate => ({
  transactionId: 'tx-1',
  kind: 'EXPENSE',
  date: '2026-10-02',
  amount: bob('245.30'),
  description: 'Supermercado',
  score: '0.9000',
  confidence: 'HIGH',
  signals: {
    amount: '1.0000',
    date: '0.8000',
    description: '1.0000',
    counterparty: '0.5000',
    origin: '1.0000',
  },
  preselected: true,
  ...over,
});

function row(over: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    id: 'row-1',
    lineNumber: 3,
    date: '2026-10-01',
    description: 'COMPRA SUPERMERCADO',
    amount: bob('245.30'),
    direction: 'OUT',
    classification: 'DUPLICATE_PROBABLE',
    decision: 'SKIP',
    issues: [],
    candidate: null,
    transactionId: null,
    failure: null,
    decidedBy: null,
    candidates: [candidate()],
    ...over,
  };
}

const catalogs = {
  loaded: true,
  accounts: [{ id: 'acc-bob', name: 'Banco BOB', currency: 'BOB', status: 'ACTIVE' }],
  activeAccounts: [
    { id: 'acc-bob', name: 'Banco BOB', currency: 'BOB', status: 'ACTIVE' },
    { id: 'acc-visa', name: 'Visa', currency: 'BOB', status: 'ACTIVE' },
  ],
  categories: [],
  groups: [],
  counterparties: [],
  tags: [],
  names: {
    account: (id: string) => (id === 'acc-visa' ? 'Visa' : undefined),
    category: (id: string) => (id === 'cat-hogar' ? 'Hogar' : undefined),
    counterparty: () => undefined,
    tag: () => undefined,
  },
  reload: noop,
  addCounterparty: noop,
} as unknown as Catalogs;

const detail = (r: ImportPreviewRow, canEdit = true) =>
  textOf(
    renderToStaticMarkup(
      <RowDetail
        row={r}
        f={f}
        job={{ status: 'AWAITING_REVIEW' }}
        canEdit={canEdit}
        catalogs={catalogs}
        accountId="acc-bob"
        accountCurrency="BOB"
        busy={false}
        onEdit={noop}
      />,
    ),
  );

describe('procesamiento por etapas', () => {
  it('[TC-IMPORTS-PIPELINE-007] muestra procesando, la etapa y las filas procesadas en una región aria-live', () => {
    const html = renderToStaticMarkup(
      <ProcessingPanel
        f={f}
        job={job({
          status: 'PROCESSING',
          stage: 'NORMALIZE',
          progress: {
            attempt: 0,
            batchCount: 0,
            batchesDone: 0,
            stage: 'NORMALIZE',
            processedRows: 1000,
            totalRows: 3000,
          },
        })}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-stage="NORMALIZE"');
    expect(html).toContain('aria-current="step"');
    expect(textOf(html)).toContain('Procesando');
    expect(textOf(html)).toContain('Etapa «Normalización»: 1000 de 3000 filas.');
  });

  it('una importación subida muestra que está en cola, sin lista de etapas', () => {
    const html = renderToStaticMarkup(<ProcessingPanel f={f} job={job({ status: 'UPLOADED' })} />);
    expect(textOf(html)).toContain('Subida, en cola');
    expect(textOf(html)).toContain('en cola');
    expect(html).not.toContain('data-stage="PARSE"');
  });

  it('[TC-IMPORTS-PIPELINE-009] la lectura fallida muestra el código traducido y la ubicación, sin filas', () => {
    const html = renderToStaticMarkup(
      <ParseFailedPanel
        f={f}
        job={job({
          status: 'PARSE_FAILED',
          failure: { code: 'IMPORT_PARSE_FAILED', pointer: '/movements/1/amount' },
        })}
        message={(code) => `mensaje:${code}`}
        newHref="/es/imports/nueva"
      />,
    );
    const text = textOf(html);
    expect(text).toContain('No se pudo leer el archivo.');
    expect(text).toContain('mensaje:IMPORT_PARSE_FAILED');
    expect(text).toContain('/movements/1/amount');
    expect(text).toContain('no tiene filas');
  });
});

describe('subida como documento', () => {
  it('ofrece los formatos importables, el perfil opcional y anuncia el progreso con aria-live', () => {
    const html = renderToStaticMarkup(
      <DocumentUploadStep
        f={f}
        accounts={[{ id: 'a', name: 'Banco BOB', currency: 'BOB' } as never]}
        profiles={[{ id: 'p', name: 'Cumbre CSV', format: 'CSV' } as ImportProfile]}
        busy
        phase="uploading"
        percent={40}
        onSubmit={noop}
      />,
    );
    expect(html).toContain('accept=".csv,.txt,.tsv,.ofx,.qfx,.qif,.json,.xlsx,.pdf"');
    expect(html).toContain('aria-live="polite"');
    expect(textOf(html)).toContain('Subiendo el archivo: 40 %');
    expect(textOf(html)).toContain('Cumbre CSV (CSV)');
  });
});

describe('ayuda de mapeo y perfiles', () => {
  it('[TC-IMPORTS-PIPELINE-031] muestra el perfil candidato y la columna faltante como texto escapado', () => {
    const html = renderToStaticMarkup(
      <MappingHelp
        f={f}
        busy={false}
        canEdit
        onApplyProfile={noop}
        onQifDateOrder={noop}
        job={job({
          status: 'AWAITING_MAPPING',
          format: 'CSV',
          missingColumns: ['<img src=x onerror=alert(1)>'],
          profileCandidates: [
            { profileId: 'p', version: 2, name: 'Cumbre caja de ahorro CSV', missingColumns: ['Importe'] },
          ],
        })}
      />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(textOf(html)).toContain('Cumbre caja de ahorro CSV');
    expect(textOf(html)).toContain('les falta: Importe');
    expect(html).toContain('data-testid="profile-candidate-apply"');
  });

  it('[TC-IMPORTS-PIPELINE-017] un QIF pide el orden día/mes; un CSV sin ayuda no muestra nada', () => {
    const qif = renderToStaticMarkup(
      <MappingHelp
        f={f}
        busy={false}
        canEdit
        onApplyProfile={noop}
        onQifDateOrder={noop}
        job={job({ format: 'QIF' })}
      />,
    );
    expect(qif).toContain('data-testid="qif-date-order"');
    const csv = renderToStaticMarkup(
      <MappingHelp
        f={f}
        busy={false}
        canEdit
        onApplyProfile={noop}
        onQifDateOrder={noop}
        job={job({ format: 'CSV' })}
      />,
    );
    expect(csv).toBe('');
  });

  it('«guardar como perfil» pide el nombre solo cuando está marcado', () => {
    const off = renderToStaticMarkup(
      <SaveAsProfile f={f} enabled={false} name="" disabled={false} onChange={noop} />,
    );
    expect(off).not.toContain('save-profile-name');
    const on = renderToStaticMarkup(
      <SaveAsProfile f={f} enabled name="Cumbre" disabled={false} onChange={noop} />,
    );
    expect(on).toContain('data-testid="save-profile-name"');
  });

  it('[TC-IMPORTS-PIPELINE-026] la tarjeta del perfil lista sus versiones y deja archivar solo a quien escribe', () => {
    const profile: ImportProfile = {
      id: 'p',
      name: 'Cumbre CSV',
      format: 'CSV',
      institutionId: 'i',
      accountId: null,
      version: 2,
      options: {},
      optionsSchemaVersion: 1,
      archivedAt: null,
      versions: [
        { version: 1, createdAt: '2026-10-20T14:00:00Z', createdBy: 'u' },
        { version: 2, createdAt: '2026-10-21T14:00:00Z', createdBy: 'u' },
      ],
      createdAt: '2026-10-20T14:00:00Z',
      updatedAt: '2026-10-21T14:00:00Z',
    };
    const render = (canEdit: boolean, p = profile) =>
      renderToStaticMarkup(
        <ul>
          <ProfileCard
            profile={p}
            f={f}
            accountName={undefined}
            timeZone="America/La_Paz"
            canEdit={canEdit}
            busy={false}
            onArchive={noop}
          />
        </ul>,
      );
    const html = render(true);
    expect(textOf(html)).toContain('2 versiones');
    expect(textOf(html)).toContain('Versión 2');
    expect(html).toContain('data-testid="profile-archive"');
    expect(render(false)).not.toContain('data-testid="profile-archive"');
    expect(render(true, { ...profile, archivedAt: '2026-10-22T10:00:00Z' })).not.toContain(
      'data-testid="profile-archive"',
    );
    expect(render(true, { ...profile, archivedAt: '2026-10-22T10:00:00Z' })).toContain('profile-archived');
  });
});

describe('revisión editable', () => {
  it('[TC-IMPORTS-PIPELINE-002] el candidato preseleccionado muestra puntaje, confianza y las cinco señales', () => {
    const text = detail(row());
    expect(text).toContain('Puntaje 0.9000');
    expect(text).toContain('Confianza alta');
    expect(text).toContain('Vinculado de entrada (preseleccionado)');
    expect(text).toContain('monto 1.0000');
    expect(text).toContain('fecha 0.8000');
    expect(text).toContain('descripción 1.0000');
    expect(text).toContain('contraparte 0.5000');
    expect(text).toContain('origen 1.0000');
    expect(text).toContain('Cuenta como decisión');
  });

  it('un candidato de confianza baja avisa que igual exige decisión', () => {
    const text = detail(
      row({
        decision: null,
        candidates: [candidate({ confidence: 'LOW', score: '0.5750', preselected: false })],
      }),
    );
    expect(text).toContain('Confianza baja');
    expect(text).toContain('Decide tú; no se omite sola.');
    expect(text).not.toContain('Vinculado de entrada');
  });

  it('[TC-IMPORTS-PIPELINE-039] muestra el origen por campo con la regla y su versión, y lo editado como manual', () => {
    const text = detail(
      row({
        classification: 'NEW',
        decision: 'CREATE',
        candidates: [],
        proposal: {
          needsCategory: false,
          categoryId: { value: 'cat-hogar', origin: 'RULE', ruleId: '0198f0aa-0000-7000', ruleVersion: 4 },
          description: { value: 'Compra', origin: 'ALIAS' },
        },
        edits: { description: 'Seguro del auto' },
      }),
    );
    expect(text).toContain('Hogar');
    expect(text).toContain('regla 0198f0aa…, versión 4');
    expect(text).toContain('Seguro del auto');
    expect(text).toContain('(manual)');
  });

  it('[TC-IMPORTS-PIPELINE-041] los textos del archivo y del compromiso se escapan (nunca HTML)', () => {
    const html = renderToStaticMarkup(
      <RowDetail
        row={row({
          candidates: [candidate({ description: '<script>alert(1)</script>' })],
          occurrenceCandidates: [
            { occurrenceId: 'o1', confidence: 'HIGH', dueDate: '2026-10-20', label: '<b>Internet</b>' },
          ],
        })}
        f={f}
        job={{ status: 'AWAITING_REVIEW' }}
        canEdit
        catalogs={catalogs}
        accountId="acc-bob"
        accountCurrency="BOB"
        busy={false}
        onEdit={noop}
      />,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Internet');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Internet&lt;/b&gt;');
  });

  it('[TC-IMPORTS-PIPELINE-048] la coincidencia se confirma o se quita solo por acción del usuario', () => {
    const occ = [
      { occurrenceId: 'o1', confidence: 'HIGH' as const, dueDate: '2026-10-20', label: 'Internet' },
    ];
    const pending = renderToStaticMarkup(
      <RowDetail
        row={row({ candidates: [], occurrenceCandidates: occ })}
        f={f}
        job={{ status: 'AWAITING_REVIEW' }}
        canEdit
        catalogs={catalogs}
        accountId="acc-bob"
        accountCurrency="BOB"
        busy={false}
        onEdit={noop}
      />,
    );
    expect(pending).toContain('data-testid="occurrence-confirm"');
    expect(pending).toContain('data-confirmed="false"');
    const confirmed = renderToStaticMarkup(
      <RowDetail
        row={row({ candidates: [], occurrenceCandidates: occ, occurrenceLink: { occurrenceId: 'o1' } })}
        f={f}
        job={{ status: 'AWAITING_REVIEW' }}
        canEdit
        catalogs={catalogs}
        accountId="acc-bob"
        accountCurrency="BOB"
        busy={false}
        onEdit={noop}
      />,
    );
    expect(confirmed).toContain('data-testid="occurrence-unlink"');
    expect(textOf(confirmed)).toContain('Vínculo confirmado.');
  });

  it('un VIEWER ve el detalle pero no los controles de edición ni de vínculo', () => {
    const html = renderToStaticMarkup(
      <RowDetail
        row={row({
          occurrenceCandidates: [
            { occurrenceId: 'o1', confidence: 'HIGH', dueDate: '2026-10-20', label: 'Internet' },
          ],
        })}
        f={f}
        job={{ status: 'AWAITING_REVIEW' }}
        canEdit={false}
        catalogs={catalogs}
        accountId="acc-bob"
        accountCurrency="BOB"
        busy={false}
        onEdit={noop}
      />,
    );
    expect(html).not.toContain('row-edit-toggle');
    expect(html).not.toContain('occurrence-confirm');
    expect(html).toContain('import-candidate-scored');
  });

  it('las filas del CSV básico no traen datos del pipeline y la tabla no agrega detalle', () => {
    const legacy = row({
      classification: 'NEW',
      decision: 'CREATE',
      candidates: undefined,
      decidedBy: undefined,
    });
    expect(hasPipelineData(legacy)).toBe(false);
    expect(hasPipelineData(row())).toBe(true);
    const html = renderToStaticMarkup(
      <PreviewTable
        rows={[legacy]}
        f={f}
        status="AWAITING_REVIEW"
        canEdit
        onDecide={noop}
        renderExtras={(r) => (hasPipelineData(r) ? <span>x</span> : null)}
      />,
    );
    expect(html).not.toContain('import-row-detail');
  });

  it('los filtros adicionales ofrecen sin categoría, confianza y las reglas vistas', () => {
    const html = renderToStaticMarkup(
      <AdvancedFilters
        f={f}
        value={{ ...EMPTY_FILTER, needsCategory: true }}
        rules={[{ ruleId: '0198f0aa-0000', version: 2 }]}
        onChange={noop}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="import-filter-confidence"');
    expect(textOf(html)).toContain('Regla 0198f0aa… (versión 2)');
  });
});

describe('saldo del extracto y resultado', () => {
  const summary: ImportPreviewSummary = {
    counts: {
      rows: 4,
      new: 3,
      alreadyImported: 0,
      probableDuplicates: 1,
      invalid: 0,
      pendingDecisions: 0,
      toCreate: 3,
      skipped: 1,
      excluded: 0,
    },
    outflows: bob('36.00'),
    inflows: bob('8000.00'),
    currentBalance: bob('4000.00'),
    resultingBalance: bob('11700.70'),
  };

  it('[TC-IMPORTS-PIPELINE-037] muestra el saldo final del extracto y la diferencia contra el resultante', () => {
    const html = renderToStaticMarkup(
      <StatementPanel
        f={f}
        job={job({
          statement: { closingBalance: bob('11718.70'), periodTo: '2026-03-31' },
          statementDifference: bob('18.00'),
        })}
        summary={summary}
        currency="BOB"
        canEdit
        busy={false}
        onSave={noop}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Saldo final del extracto');
    expect(text).toContain('11.718,70');
    expect(text).toContain('Diferencia con el saldo resultante');
    expect(text).toContain('no coincide');
    expect(html).toContain('data-zero="false"');
  });

  it('un VIEWER sin saldo del extracto no ve el panel', () => {
    const html = renderToStaticMarkup(
      <StatementPanel
        f={f}
        job={job()}
        summary={summary}
        currency="BOB"
        canEdit={false}
        busy={false}
        onSave={noop}
      />,
    );
    expect(html).toBe('');
  });

  it('[TC-IMPORTS-PIPELINE-057] si el saldo coincide ofrece abrir la reconciliación con fecha y saldo', () => {
    const html = renderToStaticMarkup(
      <ReconciliationResult
        f={f}
        offerHref="/es/cuentas/acc-bob/reconciliar?fecha=2026-03-31&saldo=1019.32"
        job={job({
          status: 'COMPLETED',
          reconciliationOffer: {
            accountId: 'acc-bob',
            statementDate: '2026-03-31',
            statementBalance: bob('1019.32'),
          },
        })}
      />,
    );
    expect(html).toContain('data-testid="import-reconcile-link"');
    expect(textOf(html)).toContain('1.019,32');
  });

  it('[TC-IMPORTS-PIPELINE-058] con diferencia lo dice y aclara que no hay ajuste automático', () => {
    const html = renderToStaticMarkup(
      <ReconciliationResult
        f={f}
        offerHref={undefined}
        job={job({ status: 'COMPLETED_WITH_DIFFERENCE', statementDifference: bob('18.00') })}
      />,
    );
    expect(textOf(html)).toContain('diferencia de');
    expect(textOf(html)).toContain('18,00');
    expect(textOf(html)).toContain('No se creó ningún ajuste automático.');
  });

  it('[TC-IMPORTS-PIPELINE-069] la cobertura por reglas se muestra como 41 de 57 (71.93 %)', () => {
    const html = renderToStaticMarkup(
      <RuleCoveragePanel
        f={f}
        job={job({
          status: 'COMPLETED',
          ruleCoverage: { rows: 57, classifiedByRule: 41, withoutCategory: 4, ratio: '0.7193' },
        })}
      />,
    );
    expect(textOf(html)).toContain('41 de 57 (71.93 %)');
    expect(html).toContain('data-ratio="0.7193"');
  });

  it('[TC-IMPORTS-PIPELINE-061] una importación deshecha parcialmente informa anuladas y bloqueadas', () => {
    const html = renderToStaticMarkup(
      <ResultStep
        job={job({
          status: 'PARTIALLY_ROLLED_BACK',
          revertSummary: {
            voided: 2,
            alreadyVoided: 0,
            blocked: 1,
            revertedAt: '2026-10-21T10:00:00Z',
            revertedBy: 'u1',
          },
        })}
        f={f}
        canEdit
        busy={false}
        messageOf={(c) => c}
        transactionsHref="/t"
        newHref="/n"
        listHref="/l"
        onRetry={noop}
        onAccept={noop}
      />,
    );
    expect(textOf(html)).toContain(
      'Importación deshecha parcialmente: 2 transacciones anuladas y 1 bloqueadas.',
    );
  });

  it('una importación deshecha muestra las anuladas', () => {
    const html = renderToStaticMarkup(
      <ResultStep
        job={job({
          status: 'ROLLED_BACK',
          revertSummary: {
            voided: 3,
            alreadyVoided: 0,
            blocked: 0,
            revertedAt: '2026-10-21T10:00:00Z',
            revertedBy: 'u1',
          },
        })}
        f={f}
        canEdit
        busy={false}
        messageOf={(c) => c}
        transactionsHref="/t"
        newHref="/n"
        listHref="/l"
        onRetry={noop}
        onAccept={noop}
      />,
    );
    expect(textOf(html)).toContain('Importación deshecha: se anularon 3 transacciones.');
  });
});
