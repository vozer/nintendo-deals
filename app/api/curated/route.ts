import { NextRequest, NextResponse } from 'next/server';
import { CuratedEntry, CuratedMap, CuratedSources } from '@/lib/types';
import { getCuratedSources, saveCuratedSource } from '@/lib/curated-storage';

export const dynamic = 'force-dynamic';

const SOURCES = new Set(['nintendolife', 'ntdeals']);
const GAME_ID = /^\d{1,20}$/;
const RUN_ID = /^[a-f0-9]{12}$/i;

function optionalNumberInRange(value: unknown, min: number, max: number): boolean {
  return value === undefined || (
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  );
}

export async function GET() {
  try {
    const sources = await getCuratedSources();
    return NextResponse.json(sources, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Failed to fetch curated sources:', error);
    return NextResponse.json({ error: 'Failed to fetch curated sources' }, { status: 500 });
  }
}

function validEntries(value: unknown, source: string): value is CuratedMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 500) return false;
  return entries.every(([fsId, raw]) => {
    if (!GAME_ID.test(fsId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const entry = raw as Partial<CuratedEntry>;
    if (entry.source !== source || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 300) {
      return false;
    }
    if (typeof entry.review !== 'string' || entry.review.length > 2000) return false;
    if (typeof entry.source_url !== 'string' || entry.source_url.length > 2048) return false;
    if (
      typeof entry.source_reference !== 'string' || !entry.source_reference.trim() || entry.source_reference.length > 2048 ||
      entry.source_platform !== 'nintendoswitch' ||
      typeof entry.source_price_eur !== 'number' || !Number.isFinite(entry.source_price_eur) ||
      entry.source_price_eur < 0 || entry.source_price_eur > 200 ||
      typeof entry.refreshed_at !== 'string' || !Number.isFinite(Date.parse(entry.refreshed_at)) ||
      typeof entry.run_id !== 'string' || !RUN_ID.test(entry.run_id)
    ) return false;
    if (!optionalNumberInRange(entry.rank, 1, 500)) return false;
    if (source === 'nintendolife' && !Number.isInteger(entry.rank)) return false;
    if (!optionalNumberInRange(entry.metacritic_score, 0, 100)) return false;
    if (!optionalNumberInRange(entry.discount_pct, 0, 100)) return false;
    if (!optionalNumberInRange(entry.days_remaining, 0, 366)) return false;
    try {
      const url = new URL(entry.source_url);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  });
}

export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.RATINGS_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected source and entries' }, { status: 400 });
    }
    const { source, entries } = body as Record<string, unknown>;
    if (typeof source !== 'string' || !SOURCES.has(source) || !validEntries(entries, source)) {
      return NextResponse.json({ error: 'Invalid or empty source snapshot' }, { status: 400 });
    }

    await saveCuratedSource(source as keyof CuratedSources, entries);
    return NextResponse.json({ saved: Object.keys(entries).length, source });
  } catch (error) {
    console.error('Failed to save curated source:', error);
    return NextResponse.json({ error: 'Failed to save curated source' }, { status: 500 });
  }
}
