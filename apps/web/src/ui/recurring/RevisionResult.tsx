import type { FormatContext } from '../dashboard/types';
import type { RecurringRevisionResult } from './types';

/** Resultado de "Cambiar esta y las siguientes": cuántas ocurrencias cambiaron y cuántas ediciones individuales se descartaron. */
export function RevisionResult({ result, f }: { result: RecurringRevisionResult; f: FormatContext }) {
  return (
    <div role="status" data-testid="revision-result" style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
      <p style={{ margin: 0 }}>
        {f.t('revision.done', { version: result.definition.currentVersionNo })}{' '}
        {f.t('revision.counts', {
          rewritten: result.rewritten,
          cancelled: result.cancelled,
          created: result.created,
          reinstated: result.reinstated,
        })}
      </p>
      {result.resetOverrides > 0 ? (
        <p style={{ margin: 0 }} data-testid="revision-reset-overrides">
          <span aria-hidden="true">ℹ</span> {f.t('revision.resetOverrides', { count: result.resetOverrides })}
        </p>
      ) : null}
    </div>
  );
}
