import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { GoalDetailPage } from '../../../../../src/ui/goals/GoalDetail';

/** `?creada=1` avisa de la alta; `?aportar=1` abre el formulario de aporte. */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; goalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, goalId } = use(params);
  setRequestLocale(locale);
  const q = use(searchParams);
  return (
    <GoalDetailPage
      goalId={goalId}
      prefill={{ created: one(q['creada']) === '1', contribute: one(q['aportar']) === '1' }}
    />
  );
}
