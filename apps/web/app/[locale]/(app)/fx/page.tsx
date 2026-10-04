import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../src/ui/common/search-params';
import { FxRatesPage } from '../../../../src/ui/fx/FxRatesPage';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const q = use(searchParams);
  const base = one(q['base']);
  const quote = one(q['quote']);
  const view = one(q['vista']);
  return (
    <FxRatesPage {...(base ? { base } : {})} {...(quote ? { quote } : {})} {...(view ? { view } : {})} />
  );
}
