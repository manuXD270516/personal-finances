import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { GoalsListPage } from '../../../../src/ui/goals/GoalsList';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <GoalsListPage />;
}
