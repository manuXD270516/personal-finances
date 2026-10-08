import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { CloseReportPage } from '../../../../../../../src/ui/planning/CloseReportPage';

export default function Page({ params }: { params: Promise<{ locale: string; periodId: string }> }) {
  const { locale, periodId } = use(params);
  setRequestLocale(locale);
  return <CloseReportPage periodId={periodId} />;
}
