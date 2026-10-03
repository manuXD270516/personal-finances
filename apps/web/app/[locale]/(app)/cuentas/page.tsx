import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AccountsPage } from '../../../../src/ui/accounts/AccountsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <AccountsPage />;
}
