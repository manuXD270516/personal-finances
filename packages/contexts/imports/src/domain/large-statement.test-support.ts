/**
 * Generador SINTETICO de extractos grandes en memoria (NO se versiona el archivo de 5 000 movimientos; docs/13 §16).
 * Los montos se calculan en centavos enteros y se escriben como texto decimal: nunca hay `number` de dinero en el producto.
 */
export interface SyntheticMovement {
  readonly index: number;
  readonly date: string;
  readonly amount: string;
  readonly description: string;
  readonly fitid: string;
}

export function syntheticMovements(count: number, startDate = '2026-01-01'): SyntheticMovement[] {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const out: SyntheticMovement[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(y, m - 1, d + Math.floor(i / 4)));
    const cents = ((i * 7919) % 90000) + 500;
    const sign = i % 4 === 3 ? '' : '-';
    out.push({
      index: i,
      date: date.toISOString().slice(0, 10),
      amount: `${sign}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
      description: `MOVIMIENTO SINTETICO ${String(i).padStart(5, '0')}`,
      fitid: `SINT${String(i).padStart(8, '0')}`,
    });
  }
  return out;
}

export function ofxSgmlOf(movements: readonly SyntheticMovement[], currency = 'BOB'): Uint8Array {
  const lines = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    '',
    '<OFX>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<STMTRS>',
  ];
  lines.push(`<CURDEF>${currency}`, '<BANKTRANLIST>');
  for (const mv of movements) {
    lines.push(
      '<STMTTRN>',
      `<DTPOSTED>${mv.date.replaceAll('-', '')}`,
      `<TRNAMT>${mv.amount}`,
      `<FITID>${mv.fitid}`,
      `<NAME>${mv.description}`,
      '</STMTTRN>',
    );
  }
  lines.push('</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', '');
  return new TextEncoder().encode(lines.join('\n'));
}
