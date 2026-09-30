import { snapshotRevision, SnapshotConflictError } from '@/lib/blob-json';
import { NextRequest, NextResponse } from 'next/server';
import { getSteamRatings, saveSteamRatings } from '@/lib/steam-storage';
import { isSteamSnapshot } from '@/lib/snapshot-validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ratings = await getSteamRatings();
    return NextResponse.json(ratings, {
      headers: { 'Cache-Control': 'no-store, max-age=0', ETag: snapshotRevision(ratings) },
    });
  } catch (error) {
    console.error('Failed to fetch steam ratings:', error);
    return NextResponse.json({}, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.RATINGS_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const ratings: unknown = await req.json();
    if (!isSteamSnapshot(ratings)) {
      return NextResponse.json({ error: 'Invalid Steam snapshot' }, { status: 400 });
    }
    const count = Object.keys(ratings).length;

    const revision = req.headers.get('if-match');
    if (!revision) return NextResponse.json({ error: 'Read the snapshot ETag and send If-Match before publishing' }, { status: 428 });
    const existing = await getSteamRatings();
    if (snapshotRevision(existing) !== revision) return NextResponse.json({ error: 'Snapshot changed; read and stage again' }, { status: 409 });

    await saveSteamRatings(ratings, revision);
    return NextResponse.json({ saved: count });
  } catch (error) {
    if (error instanceof SnapshotConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('Failed to save steam ratings:', error);
    return NextResponse.json(
      { error: 'Failed to save steam ratings' },
      { status: 500 },
    );
  }
}
