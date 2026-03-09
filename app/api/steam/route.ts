import { NextRequest, NextResponse } from 'next/server';
import { getSteamRatings, saveSteamRatings } from '@/lib/steam-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ratings = await getSteamRatings();
    return NextResponse.json(ratings, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
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
    const ratings = await req.json();
    const count = Object.keys(ratings).length;

    if (count === 0) {
      return NextResponse.json(
        { error: 'Refusing to save empty data — would wipe existing entries' },
        { status: 400 },
      );
    }

    const existing = await getSteamRatings();
    const existingCount = Object.keys(existing).length;
    if (existingCount > 100 && count < existingCount * 0.5) {
      return NextResponse.json(
        { error: `Refusing destructive write: would drop from ${existingCount} to ${count} entries. Use x-force-overwrite: true header to override.` },
        { status: 400 },
      );
    }

    const forceOverwrite = req.headers.get('x-force-overwrite') === 'true';
    if (!forceOverwrite && existingCount > 100 && count < existingCount * 0.8) {
      return NextResponse.json(
        { warning: `Significant reduction: ${existingCount} → ${count}. Add x-force-overwrite: true to proceed.`, saved: 0 },
        { status: 409 },
      );
    }

    await saveSteamRatings(ratings);
    return NextResponse.json({ saved: count });
  } catch (error) {
    console.error('Failed to save steam ratings:', error);
    return NextResponse.json(
      { error: 'Failed to save steam ratings' },
      { status: 500 },
    );
  }
}
