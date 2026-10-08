import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { CloseMonthPage } from '../../../../../../../src/ui/planning/CloseMonthPage';

export default function Page({ params }: { params: Promise<{ locale: string; periodId: string }> }) {
  const { locale, periodId } = use(params);
  setRequestLocale(locale);
  return <CloseMonthPage periodId={periodId} />;
}
