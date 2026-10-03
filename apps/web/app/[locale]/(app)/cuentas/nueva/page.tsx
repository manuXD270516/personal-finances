import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NewAccountPage } from '../../../../../src/ui/accounts/AccountDetail';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NewAccountPage />;
}
