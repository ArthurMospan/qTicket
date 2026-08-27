import LegalDocumentPage from '../_components/LegalDocumentPage';
import { LEGAL_DOCUMENTS } from '@/lib/content/legalDocuments.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = { title: 'Умови користування', description: LEGAL_DOCUMENTS.terms.summary, alternates: { canonical: canonicalUrl('/terms') } };
export default function TermsPage() { return <LegalDocumentPage document={LEGAL_DOCUMENTS.terms} />; }
