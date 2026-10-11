import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ComparePageView } from '../../../../../../src/ui/debt/ComparePage';

export default function Page({ params }: { params: Promise<{ locale: string; loanId: string }> }) {
  const { locale, loanId } = use(params);
  setRequestLocale(locale);
  return <ComparePageView loanId={loanId} />;
}
