import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Not knowing the key is as fatal as having the wrong one: a fallback here
 * would mean writing a QuickTeam+ refresh token to Firestore in the clear.
 */
function getKey() {
  const raw = process.env.QTPLUS_TOKEN_KEY;
  if (!raw) {
    throw new Error('QTPLUS_TOKEN_KEY is not configured — refusing to handle QuickTeam+ tokens.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`QTPLUS_TOKEN_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

export function seal(plaintext) {
  // A fresh IV per seal. Reusing one under GCM leaks the plaintext relationship
  // between two ciphertexts and breaks the authentication guarantee outright.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Thrown when a sealed box cannot be opened: a rotated key, or tampering. */
export class SealedBoxUnreadableError extends Error {
  constructor(cause) {
    super('Sealed box could not be opened.');
    this.name = 'SealedBoxUnreadableError';
    this.code = 'SEALED_BOX_UNREADABLE';
    this.cause = cause;
  }
}

export function open(box) {
  if (!box || box.v !== 1) throw new SealedBoxUnreadableError();

  // Outside the try on purpose: a missing or malformed QTPLUS_TOKEN_KEY is an
  // operator error, not an unreadable box, and «reconnect it» would be the
  // wrong advice for it — reconnecting cannot seal a token either.
  const key = getKey();
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    // GCM: a wrong key or a single flipped byte makes final() throw. That is the
    // point — a tampered token must be an error, never a different value that
    // quietly gets used.
    return Buffer.concat([
      decipher.update(Buffer.from(box.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    // Node's own words for a failed GCM tag are «Unsupported state or unable to
    // authenticate data», and that sentence was reaching people: the importer
    // stores whatever an error says onto the job, and the settings screen prints
    // it. A caller can say what this means in the language of the thing it was
    // opening; the crypto layer cannot, so it raises a type instead of prose.
    throw new SealedBoxUnreadableError(error);
  }
}
