import { NextRequest, NextResponse } from 'next/server';
import { getMedia, saveMedia } from '@/lib/media-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const media = await getMedia();
    return NextResponse.json(media, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
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
    const media = await req.json();
    await saveMedia(media);
    return NextResponse.json({ saved: Object.keys(media).length });
  } catch (error) {
    console.error('Failed to save media:', error);
    return NextResponse.json(
      { error: 'Failed to save media' },
      { status: 500 },
    );
  }
}
