'use client';

import { auth } from '@/lib/firebase';

export class InvoiceRequestError extends Error {
  constructor(
    message,
    {
      code = '',
      status = 0,
      sourceTimeLogIds = [],
      sourceItemIds = [],
    } = {},
  ) {
    super(message);
    this.name = 'InvoiceRequestError';
    this.code = code;
    this.status = status;
    this.sourceTimeLogIds = sourceTimeLogIds;
    this.sourceItemIds = sourceItemIds;
  }
}

export async function createInvoiceViaApi({
  organizationId,
  projectId,
  invoice,
}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new InvoiceRequestError('Потрібна авторизація', { status: 401 });

  const response = await fetch('/api/invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ organizationId, projectId, invoice }),
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    // Preserve the HTTP status even if an upstream proxy returned non-JSON.
  }
  if (!response.ok) {
    throw new InvoiceRequestError(
      result.error || 'Не вдалося створити рахунок',
      {
        code: result.code || '',
        status: response.status,
        sourceTimeLogIds: Array.isArray(result.sourceTimeLogIds)
          ? result.sourceTimeLogIds
          : [],
        sourceItemIds: Array.isArray(result.sourceItemIds)
          ? result.sourceItemIds
          : [],
      },
    );
  }
  return result;
}

export async function voidInvoiceViaApi(invoiceId) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new InvoiceRequestError('Потрібна авторизація', { status: 401 });
  }
  const response = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/void`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new InvoiceRequestError(
      result.error || 'Не вдалося анулювати рахунок',
      {
        code: result.code || '',
        status: response.status,
        sourceTimeLogIds: Array.isArray(result.sourceTimeLogIds)
          ? result.sourceTimeLogIds
          : [],
        sourceItemIds: Array.isArray(result.sourceItemIds)
          ? result.sourceItemIds
          : [],
      },
    );
  }
  return result;
}
