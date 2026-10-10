import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../../src/ui/common/search-params';
import { SubscriptionDetailPage } from '../../../../../../src/ui/subscriptions/SubscriptionDetail';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; subscriptionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, subscriptionId } = use(params);
  setRequestLocale(locale);
  const query = use(searchParams);
  const proposalId = one(query['propuesta']);
  return (
    <SubscriptionDetailPage
      subscriptionId={subscriptionId}
      {...(proposalId ? { proposalId } : {})}
      fromList={one(query['historial']) === '1'}
    />
  );
}
