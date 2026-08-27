const REJECTED_ID_TOKEN_CODES = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

const INFRASTRUCTURE_CODES = new Set([
  'EACCES',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

function errorChain(error) {
  const chain = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/** Whether Firebase rejected the credential itself, rather than failing to verify it. */
export function isRejectedIdTokenError(error) {
  const chain = errorChain(error);
  if (chain.some(item => INFRASTRUCTURE_CODES.has(String(item?.code || item?.errno || '').toUpperCase()))) {
    return false;
  }
  const code = String(error?.code || '');
  if (REJECTED_ID_TOKEN_CODES.has(code)) return true;
  if (code !== 'auth/argument-error') return false;

  // Admin SDK also wraps credential/config/network failures as argument-error.
  // Only token-shaped messages are a 401 attributable to the caller.
  const message = chain.map(item => String(item?.message || '').toLowerCase()).join(' ');
  return message.includes('id token')
    || message.includes('id-token')
    || message.includes('jwt');
}
