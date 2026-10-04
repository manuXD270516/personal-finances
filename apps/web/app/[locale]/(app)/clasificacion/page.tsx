import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ClassificationPage } from '../../../../src/ui/classification/ClassificationPage';
import { one } from '../../../../src/ui/common/search-params';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const view = one(use(searchParams)['vista']);
  return <ClassificationPage {...(view ? { view } : {})} />;
}
