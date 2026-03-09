import { NextRequest, NextResponse } from 'next/server';
import { getRatings, saveRatings } from '@/lib/ratings-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ratings = await getRatings();
    return NextResponse.json(ratings, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Failed to fetch ratings:', error);
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
    const ratings = await req.json();
    const count = Object.keys(ratings).length;

    if (count === 0) {
      return NextResponse.json(
        { error: 'Refusing to save empty data — would wipe existing entries' },
        { status: 400 },
      );
    }

    const existing = await getRatings();
    const existingCount = Object.keys(existing).length;
    if (existingCount > 100 && count < existingCount * 0.5) {
      return NextResponse.json(
        { error: `Refusing destructive write: would drop from ${existingCount} to ${count} entries. Use x-force-overwrite: true header to override.` },
        { status: 400 },
      );
    }

    await saveRatings(ratings);
    return NextResponse.json({ saved: count });
  } catch (error) {
    console.error('Failed to save ratings:', error);
    return NextResponse.json(
      { error: 'Failed to save ratings' },
      { status: 500 },
    );
  }
}
