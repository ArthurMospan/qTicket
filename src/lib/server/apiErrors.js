import 'server-only';

import { NextResponse } from 'next/server';
import { isQuotaExceededError } from '@/lib/utils/errors';

export class InvalidJsonBodyError extends Error {
  constructor({
    code = 'INVALID_JSON',
    message = 'Тіло запиту має бути коректним JSON',
  } = {}) {
    super(code);
    this.name = 'InvalidJsonBodyError';
    this.code = code;
    this.responseMessage = message;
  }
}

export async function readJsonBody(request, options) {
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonBodyError(options);
  }
}

export function routeErrorResponse(error, { context, fallbackMessage }) {
  if (error instanceof InvalidJsonBodyError) {
    return NextResponse.json({
      error: error.responseMessage,
      code: error.code,
    }, { status: 400 });
  }

  if (isQuotaExceededError(error)) {
    console.warn(`[${context}] Firestore quota exceeded`);
    return NextResponse.json({
      error: 'Database is temporarily unavailable because its quota is exhausted',
      code: 'firestore-quota-exceeded',
    }, {
      status: 503,
      headers: { 'Retry-After': '60' },
    });
  }

  console.error(`[${context}]`, error);
  return NextResponse.json({ error: fallbackMessage, code: 'internal-error' }, { status: 500 });
}
