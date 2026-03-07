import { NextRequest, NextResponse } from 'next/server';
import { getRatings, saveRatings } from '@/lib/ratings-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ratings = await getRatings();
    return NextResponse.json(ratings);
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
    await saveRatings(ratings);
    return NextResponse.json({ saved: Object.keys(ratings).length });
  } catch (error) {
    console.error('Failed to save ratings:', error);
    return NextResponse.json(
      { error: 'Failed to save ratings' },
      { status: 500 },
    );
  }
}
