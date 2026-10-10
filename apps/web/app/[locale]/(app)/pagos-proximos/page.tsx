import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { UpcomingPaymentsPage } from '../../../../src/ui/upcoming/UpcomingPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <UpcomingPaymentsPage />;
}
