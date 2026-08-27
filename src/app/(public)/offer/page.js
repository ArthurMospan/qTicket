import LegalDocumentPage from '../_components/LegalDocumentPage';
import { LEGAL_DOCUMENTS } from '@/lib/content/legalDocuments.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = { title: 'Публічна оферта', description: LEGAL_DOCUMENTS.offer.summary, alternates: { canonical: canonicalUrl('/offer') } };
export default function OfferPage() { return <LegalDocumentPage document={LEGAL_DOCUMENTS.offer} />; }
