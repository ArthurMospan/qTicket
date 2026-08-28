import { redirect } from 'next/navigation';

// qTicket organizations are provisioned by QuickTeam. Keep this legacy route
// only as a safe destination for old bookmarks and cached deployments.
export default function OnboardingPage() {
  redirect('/');
}
