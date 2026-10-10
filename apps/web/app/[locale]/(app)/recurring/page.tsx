import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { RecurringPage } from '../../../../src/ui/recurring/RecurringPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <RecurringPage />;
}
