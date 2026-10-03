import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AccountDetailPage } from '../../../../../src/ui/accounts/AccountDetail';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, accountId } = use(params);
  setRequestLocale(locale);
  const created = use(searchParams)['creada'] === '1';
  return <AccountDetailPage accountId={accountId} created={created} />;
}
