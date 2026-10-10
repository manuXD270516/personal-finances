import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { SubscriptionsPage } from '../../../../../src/ui/subscriptions/SubscriptionsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <SubscriptionsPage />;
}
