import { snapshotRevision, SnapshotConflictError } from '@/lib/blob-json';
import { NextRequest, NextResponse } from 'next/server';
import { getMedia, saveMedia } from '@/lib/media-storage';
import { isMediaSnapshot } from '@/lib/snapshot-validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const media = await getMedia();
    return NextResponse.json(media, {
      headers: { 'Cache-Control': 'no-store, max-age=0', ETag: snapshotRevision(media) },
    });
  } catch (error) {
    console.error('Failed to fetch media:', error);
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
    const media: unknown = await req.json();
    if (!isMediaSnapshot(media)) {
      return NextResponse.json({ error: 'Invalid media snapshot' }, { status: 400 });
    }
    const count = Object.keys(media).length;

    const revision = req.headers.get('if-match');
    if (!revision) return NextResponse.json({ error: 'Read the snapshot ETag and send If-Match before publishing' }, { status: 428 });
    const existing = await getMedia();
    if (snapshotRevision(existing) !== revision) return NextResponse.json({ error: 'Snapshot changed; read and stage again' }, { status: 409 });

    await saveMedia(media, revision);
    return NextResponse.json({ saved: count });
  } catch (error) {
    if (error instanceof SnapshotConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('Failed to save media:', error);
    return NextResponse.json(
      { error: 'Failed to save media' },
      { status: 500 },
    );
  }
}
