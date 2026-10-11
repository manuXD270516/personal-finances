import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { LoanDetailPage } from '../../../../../src/ui/debt/LoanDetail';

/** `?pagar=1&cuota=N&fecha=YYYY-MM-DD` abre el formulario de pago prellenado (acción "Registrar pago" de Recurrentes). */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; loanId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, loanId } = use(params);
  setRequestLocale(locale);
  const q = use(searchParams);
  const cuota = one(q['cuota']);
  const fecha = one(q['fecha']);
  return (
    <LoanDetailPage
      loanId={loanId}
      prefill={{
        open: one(q['pagar']) === '1',
        installmentNo: cuota && /^\d+$/.test(cuota) ? Number(cuota) : undefined,
        date: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : undefined,
      }}
    />
  );
}
