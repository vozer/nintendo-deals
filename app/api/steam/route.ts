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
    await saveSteamRatings(ratings);
    return NextResponse.json({ saved: Object.keys(ratings).length });
  } catch (error) {
    console.error('Failed to save steam ratings:', error);
    return NextResponse.json(
      { error: 'Failed to save steam ratings' },
      { status: 500 },
    );
  }
}
