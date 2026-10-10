import type { CSSProperties } from 'react';
import type { FormatContext } from '../dashboard/types';
import { WIZARD_STEPS, type WizardStep } from './logic';

const STEP_KEYS: Readonly<Record<WizardStep, string>> = {
  1: 'steps.upload',
  2: 'steps.mapping',
  3: 'steps.review',
  4: 'steps.result',
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--pf-space-2) var(--pf-space-4)',
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

/**
 * Indicador de los 4 pasos (Archivo, Columnas, Revisar, Resultado; docs/28 §4.7). El paso actual lleva
 * `aria-current="step"` y el texto "paso actual" (no solo negrita o color); los pasos hechos se rotulan "completado".
 */
export function StepIndicator({ current, f }: { current: WizardStep; f: FormatContext }) {
  return (
    <nav aria-label={f.t('steps.label')} data-testid="import-steps">
      <ol style={listStyle}>
        {WIZARD_STEPS.map((n) => {
          const state = n < current ? 'done' : n === current ? 'current' : 'todo';
          return (
            <li
              key={n}
              data-step={n}
              data-state={state}
              {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
              style={{
                fontWeight: state === 'current' ? 700 : 400,
                color: state === 'todo' ? 'var(--pf-fg-muted)' : 'var(--pf-fg)',
              }}
            >
              <span aria-hidden="true">{state === 'done' ? '✓ ' : `${n}. `}</span>
              {f.t(STEP_KEYS[n])}
              {state === 'current' ? <span className="pf-sr-only"> ({f.t('steps.current')})</span> : null}
              {state === 'done' ? <span className="pf-sr-only"> ({f.t('steps.done')})</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
