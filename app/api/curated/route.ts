import { NextRequest, NextResponse } from 'next/server';
import { getCuratedMap, saveCuratedMap } from '@/lib/curated-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const map = await getCuratedMap();
    return NextResponse.json(map, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Failed to fetch curated map:', error);
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
    const map = await req.json();
    await saveCuratedMap(map);
    return NextResponse.json({ saved: Object.keys(map).length });
  } catch (error) {
    console.error('Failed to save curated map:', error);
    return NextResponse.json(
      { error: 'Failed to save curated map' },
      { status: 500 },
    );
  }
}
