import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';

export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const auth = getAdminAuth();
    const userRecord = await auth.getUser(authorization.user.uid);
    const hasGithub = userRecord.providerData.some(provider => provider.providerId === 'github.com');
    const hasGoogle = userRecord.providerData.some(provider => provider.providerId === 'google.com');

    if (!hasGithub && !hasGoogle) {
      return NextResponse.json({
        error: 'primary_provider',
        message: 'OneB є основним способом входу. Підключіть GitHub або Google перед відключенням.',
      }, { status: 409 });
    }

    await auth.setCustomUserClaims(userRecord.uid, {
      ...(userRecord.customClaims || {}),
      oneb_connected: false,
    });

    // The login route resolves a OneB sign-in by `onebId` alone, so an
    // «unlinked» account that kept the id still let that OneB account in.
    // Unlinking removes the binding, not only the flag.
    await getAdminDb().collection('users').doc(userRecord.uid).set({
      onebConnected: false,
      onebId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[oneb-unlink] Failed:', error);
    return NextResponse.json({ error: 'Failed to unlink OneB' }, { status: 500 });
  }
}
