import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedRequest } from '@/lib/request-auth';
import { applyPreferencesAction, parsePreferencesAction } from '@/lib/preferences-actions';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = parsePreferencesAction(await req.json());
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid action payload' }, { status: 400 });
    }

    const result = await applyPreferencesAction(parsed);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error('Failed to apply preferences action:', error);
    return NextResponse.json({ error: 'Failed to apply action' }, { status: 500 });
  }
}
