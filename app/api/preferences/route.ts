import { NextRequest, NextResponse } from 'next/server';
import {
  getPreferences,
  getPreferencesStrict,
  normalizePreferences,
  savePreferences,
} from '@/lib/blob-storage';
import { isAuthorizedRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

type RawPreferencesPayload = {
  hiddenGames: unknown;
  watchGames: unknown;
  thinkingAbout: unknown;
};

function isValidPreferencesPayload(value: unknown): value is RawPreferencesPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    Array.isArray(payload.hiddenGames) &&
    !!payload.watchGames &&
    typeof payload.watchGames === 'object' &&
    !Array.isArray(payload.watchGames) &&
    Array.isArray(payload.thinkingAbout)
  );
}

function parseForceOverwriteHeader(req: NextRequest): boolean {
  const force = req.headers.get('x-force-overwrite');
  if (!force) return false;
  return force === '1' || force.toLowerCase() === 'true';
}

function isDestructiveDrop(before: number, after: number): boolean {
  if (before === 0) return false;
  const dropped = before - after;
  if (dropped <= 0) return false;
  return dropped >= 3 && dropped / before > 0.5;
}

export async function GET() {
  try {
    const prefs = await getPreferences();
    return NextResponse.json(prefs, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Failed to read preferences:', error);
    return NextResponse.json(
      { error: 'Failed to read preferences' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!isValidPreferencesPayload(body)) {
      return NextResponse.json(
        { error: 'Invalid preferences format' },
        { status: 400 },
      );
    }

    const incoming = normalizePreferences(body);
    const current = await getPreferencesStrict();

    const destructive =
      isDestructiveDrop(current.hiddenGames.length, incoming.hiddenGames.length) ||
      isDestructiveDrop(
        Object.keys(current.watchGames).length,
        Object.keys(incoming.watchGames).length,
      ) ||
      isDestructiveDrop(current.thinkingAbout.length, incoming.thinkingAbout.length);

    if (destructive && !parseForceOverwriteHeader(req)) {
      return NextResponse.json(
        {
          error:
            'Destructive preferences update blocked. Retry with x-force-overwrite: true if intentional.',
        },
        { status: 409 },
      );
    }

    await savePreferences(incoming);
    return NextResponse.json(incoming);
  } catch (error) {
    console.error('Failed to save preferences:', error);
    return NextResponse.json(
      { error: 'Failed to save preferences' },
      { status: 500 },
    );
  }
}
