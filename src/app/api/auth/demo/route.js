import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Demo login is disabled' }, { status: 404 });
}
