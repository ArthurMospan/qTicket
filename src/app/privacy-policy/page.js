import { permanentRedirect } from 'next/navigation';

export default function LegacyPrivacyPolicyPage() {
  permanentRedirect('/privacy');
}
