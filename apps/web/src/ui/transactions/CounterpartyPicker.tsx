'use client';

import { useId, useState } from 'react';
import { FinanceApiError } from '../../bff/finance-api-client';
import type { FormatContext } from '../dashboard/types';
import type { Counterparty } from '../common/types';
import { fieldStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import type { WorkspaceContext } from '../common/workspace';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * Selector de contraparte con creación en línea (add-classification 8.2, TC-CLASSIFICATION-COUNTERPARTY-002): se
 * escribe el nombre; si coincide con una activa (sin distinguir mayúsculas ni acentos) se selecciona, si no se
 * ofrece crearla. Ante `409 NAME_TAKEN` la API devuelve `existingId` y la UI selecciona la existente.
 */
export function CounterpartyPicker({
  ctx,
  f,
  counterparties,
  value,
  onChange,
  onCreated,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  counterparties: readonly Counterparty[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (c: Counterparty) => void;
}) {
  const { t } = f;
  const id = useId();
  const active = counterparties.filter((c) => !c.archivedAt);
  const selected = counterparties.find((c) => c.id === value);
  const [text, setText] = useState(selected?.name ?? '');
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const match = active.find((c) => normalize(c.name) === normalize(text));

  function onText(next: string) {
    setText(next);
    setMessage(undefined);
    const m = active.find((c) => normalize(c.name) === normalize(next));
    onChange(m?.id ?? '');
  }

  async function create() {
    const name = text.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const r = await ctx.api.command<Counterparty>('POST', `${ctx.base}/counterparties`, { name });
      onCreated(r.data!);
      onChange(r.data!.id);
      setText(r.data!.name);
      setMessage(t('counterparty.created', { name: r.data!.name }));
    } catch (err) {
      const existingId = err instanceof FinanceApiError ? err.problem['existingId'] : undefined;
      if (
        err instanceof FinanceApiError &&
        err.problem.code === 'NAME_TAKEN' &&
        typeof existingId === 'string'
      ) {
        const existing =
          counterparties.find((c) => c.id === existingId) ??
          (await ctx.api
            .get<Counterparty>(`${ctx.base}/counterparties/${existingId}`)
            .then((r) => r.data)
            .catch(() => undefined));
        if (existing) {
          onCreated(existing);
          setText(existing.name);
        }
        onChange(existingId);
        setMessage(t('counterparty.existing', { name: existing?.name ?? name }));
      } else {
        setMessage(t('counterparty.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={fieldStyle}>
      <label htmlFor={id}>{t('form.counterparty')}</label>
      <div style={rowStyle}>
        <input
          id={id}
          name="counterparty"
          list={`${id}-list`}
          autoComplete="off"
          style={{ ...inputStyle, flex: '1 1 10rem' }}
          value={text}
          aria-describedby={`${id}-status`}
          onChange={(e) => onText(e.target.value)}
        />
        <datalist id={`${id}-list`}>
          {active.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        {text.trim() && !match && ctx.canEdit ? (
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            data-testid="create-counterparty"
          >
            {t('counterparty.create', { name: text.trim() })}
          </button>
        ) : null}
      </div>
      <small id={`${id}-status`} role="status" style={mutedStyle} data-testid="counterparty-status">
        {message ?? (value && match ? t('counterparty.selected', { name: match.name }) : '')}
      </small>
    </div>
  );
}
