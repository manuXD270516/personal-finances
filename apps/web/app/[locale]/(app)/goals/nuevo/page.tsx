import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NewGoalPage } from '../../../../../src/ui/goals/GoalForm';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NewGoalPage />;
}
