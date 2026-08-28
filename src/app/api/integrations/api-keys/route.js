import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb, hashApiKey } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';

async function authorize(request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
  return { organizationId, authorization };
}

async function loadAndMigrateKeys(db, organizationId) {
  const orgRef = db.collection('organizations').doc(organizationId);
  const keysRef = orgRef.collection('private').doc('apiKeys');
  const [keysSnap, orgSnap] = await Promise.all([keysRef.get(), orgRef.get()]);
  if (!orgSnap.exists) throw new Error('Organization not found');
  if (keysSnap.exists) return { keysRef, keys: keysSnap.data().keys || [] };

  const legacyKeys = (orgSnap.data().apiKeys || []).map(key => {
    if (!key.token) return key;
    const { token, ...rest } = key;
    return { ...rest, prefix: token.slice(0, 10), tokenHash: hashApiKey(token) };
  });
  const batch = db.batch();
  batch.set(keysRef, { keys: legacyKeys, updatedAt: FieldValue.serverTimestamp() });
  if (orgSnap.data().apiKeys) batch.update(orgRef, { apiKeys: FieldValue.delete() });
  await batch.commit();
  return { keysRef, keys: legacyKeys };
}

export async function GET(request) {
  try {
    const { organizationId, authorization } = await authorize(request);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const { keys } = await loadAndMigrateKeys(getAdminDb(), organizationId);
    const publicKeys = keys.map(({ tokenHash, token, ...key }) => key);
    return NextResponse.json({ keys: publicKeys });
  } catch (error) {
    return routeErrorResponse(error, { context: 'API keys GET', fallbackMessage: 'Internal Server Error' });
  }
}

export async function POST(request) {
  try {
    const { organizationId, authorization } = await authorize(request);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const { name } = await readJsonBody(request);
    const safeName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (!safeName) return NextResponse.json({ error: 'Key name is required' }, { status: 400 });

    const db = getAdminDb();
    const { keysRef, keys } = await loadAndMigrateKeys(db, organizationId);
    const token = `qt_${randomBytes(32).toString('hex')}`;
    const storedKey = {
      id: randomUUID(),
      prefix: token.slice(0, 10),
      tokenHash: hashApiKey(token),
      name: safeName,
      createdAt: new Date().toISOString(),
      createdBy: authorization.user.uid,
      active: true,
    };
    await keysRef.set({ keys: [...keys, storedKey], updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ key: { ...storedKey, token, tokenHash: undefined } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, { context: 'API keys POST', fallbackMessage: 'Internal Server Error' });
  }
}

export async function DELETE(request) {
  try {
    const { organizationId, authorization } = await authorize(request);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const { keyId } = await readJsonBody(request);
    if (!keyId) return NextResponse.json({ error: 'Key id is required' }, { status: 400 });

    const db = getAdminDb();
    const { keysRef, keys } = await loadAndMigrateKeys(db, organizationId);
    await keysRef.set({
      keys: keys.filter(key => key.id !== keyId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, { context: 'API keys DELETE', fallbackMessage: 'Internal Server Error' });
  }
}
