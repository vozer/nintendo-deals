import { NextRequest, NextResponse } from 'next/server';
import { fetchDeals } from '@/lib/nintendo-api';
import { SortOption } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_SORTS: SortOption[] = ['discount', 'price_asc', 'price_desc', 'title', 'popularity', 'rating', 'value'];
const SERVER_SORT_MAP: Partial<Record<SortOption, SortOption>> = { rating: 'popularity', value: 'popularity' };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const sortParam = searchParams.get('sort') || 'popularity';
  const sort: SortOption = VALID_SORTS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : 'popularity';
  const search = searchParams.get('search') || undefined;
  const start = Math.max(0, Number(searchParams.get('start') || 0));
  const rows = Math.min(100, Math.max(1, Number(searchParams.get('rows') || 48)));

  try {
    const serverSort = SERVER_SORT_MAP[sort] || sort;
    const tab = searchParams.get('tab') || undefined;
    const data = await fetchDeals({ sort: serverSort, search, start, rows, tab });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch Nintendo deals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deals from Nintendo' },
      { status: 502 },
    );
  }
}
