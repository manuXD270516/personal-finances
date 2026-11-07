import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { CashFlowPage } from '../../../../src/ui/cash-flow/CashFlowPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <CashFlowPage />;
}
