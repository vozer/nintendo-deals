import { NextRequest, NextResponse } from 'next/server';
import { fetchGameById } from '@/lib/nintendo-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fsId = searchParams.get('fs_id')?.trim() || '';

  if (!/^\d+$/.test(fsId)) {
    return NextResponse.json({ error: 'Invalid fs_id' }, { status: 400 });
  }

  try {
    const game = await fetchGameById(fsId);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    return NextResponse.json({ game });
  } catch (error) {
    console.error('Failed to fetch game by fs_id:', error);
    return NextResponse.json({ error: 'Failed to fetch game' }, { status: 502 });
  }
}
