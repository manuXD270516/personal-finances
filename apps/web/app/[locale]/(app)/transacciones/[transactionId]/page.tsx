import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { TransactionDetailPage } from '../../../../../src/ui/transactions/TransactionDetail';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; transactionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, transactionId } = use(params);
  setRequestLocale(locale);
  const notice = one(use(searchParams)['aviso']);
  return <TransactionDetailPage transactionId={transactionId} {...(notice ? { notice } : {})} />;
}
