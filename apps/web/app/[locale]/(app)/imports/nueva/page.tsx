import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { NewImportPage } from '../../../../../src/ui/imports/ImportWizard';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const accountId = one(use(searchParams)['cuenta']);
  return <NewImportPage accountId={accountId} />;
}
