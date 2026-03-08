import { NextRequest, NextResponse } from 'next/server';
import { getCuratedList, saveCuratedList } from '@/lib/curated-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const list = await getCuratedList();
    return NextResponse.json(list, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Failed to fetch curated list:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.RATINGS_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const list = await req.json();
    await saveCuratedList(list);
    return NextResponse.json({ saved: list.length });
  } catch (error) {
    console.error('Failed to save curated list:', error);
    return NextResponse.json(
      { error: 'Failed to save curated list' },
      { status: 500 },
    );
  }
}
