import LegalDocumentPage from '../_components/LegalDocumentPage';
import { LEGAL_DOCUMENTS } from '@/lib/content/legalDocuments.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = { title: 'Політика конфіденційності', description: LEGAL_DOCUMENTS.privacy.summary, alternates: { canonical: canonicalUrl('/privacy') } };
export default function PrivacyPage() { return <LegalDocumentPage document={LEGAL_DOCUMENTS.privacy} />; }
