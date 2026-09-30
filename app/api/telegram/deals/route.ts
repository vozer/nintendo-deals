import { get as blobGet, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { hasValidApiKey } from '@/lib/request-auth';
import { getPreferences } from '@/lib/blob-storage';
import { getRatings } from '@/lib/ratings-storage';
import { getSteamRatings } from '@/lib/steam-storage';
import { getCuratedSources } from '@/lib/curated-storage';
import { isHomepageDeal } from '@/lib/filters';
import { NintendoGame } from '@/lib/types';
import policy from '@/shared/content-policy.json';

export const dynamic = 'force-dynamic';
const KEY = 'telegram-deals.json';
const token = () => process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 20000
  && ids.every(id => typeof id === 'string' && /^\d+$/.test(id)) && new Set(ids).size === ids.length;
const validDate = (date: unknown): date is string => typeof date === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

async function readSnapshot() {
  const result = await blobGet(KEY, { access: 'private', token: token(), useCache: false,
    headers: { 'Accept-Encoding': 'identity' } });
  if (!result) return { eligibleIds: [] as string[], etag: null as string | null, date: null as string | null };
  if (result.statusCode !== 200) throw new Error('Unexpected deal snapshot response');
  const value = JSON.parse(await new Response(result.stream).text());
  if (!validIds(value?.eligibleIds) || !validDate(value?.date)) throw new Error('Invalid deal snapshot');
  return { eligibleIds: value.eligibleIds as string[], etag: result.blob.etag as string | null, date: value.date as string | null };
}

function validGame(value: unknown): value is NintendoGame & { system_type: string[] } {
  if (!value || typeof value !== 'object') return false;
  const game = value as Record<string, unknown>;
  return typeof game.fs_id === 'string' && /^\d+$/.test(game.fs_id)
    && typeof game.title === 'string' && typeof game.publisher === 'string'
    && typeof game.price_discounted_f === 'number' && Number.isFinite(game.price_discounted_f)
    && typeof game.price_has_discount_b === 'boolean'
    && ['pretty_game_categories_txt', 'game_categories_txt', 'system_type'].every(key =>
      Array.isArray(game[key]) && (game[key] as unknown[]).every(item => typeof item === 'string'));
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { games, total } = await req.json();
    if (!Array.isArray(games) || !Number.isInteger(total) || total < 1 || total > 20000
      || games.length !== total || !games.every(validGame) || new Set(games.map(game => game.fs_id)).size !== total) {
      return NextResponse.json({ error: 'Invalid or incomplete catalog' }, { status: 400 });
    }
    const [snapshot, preferences, ratings, steam, curated] = await Promise.all([
      readSnapshot(), getPreferences(), getRatings(), getSteamRatings(), getCuratedSources(),
    ]);
    const eligibleIds = (games as Array<NintendoGame & { system_type: string[] }>).filter(game =>
      game.system_type.some(system => system.startsWith(policy.switchSystemPrefix))
      && !game.system_type.includes(policy.excludedSystemType)
      && game.price_has_discount_b && game.price_discounted_f >= 0 && game.price_discounted_f <= policy.maxDiscountedPriceEur
      && !preferences.watchGames[game.fs_id]
      && isHomepageDeal(game, preferences, ratings[game.fs_id], steam[game.fs_id], !!curated.nintendolife[game.fs_id])
    ).map(game => game.fs_id).sort();
    const previous = new Set(snapshot.eligibleIds);
    return NextResponse.json({ eligibleIds, newIds: snapshot.etag === null ? [] : eligibleIds.filter(id => !previous.has(id)),
      initialized: snapshot.etag !== null, etag: snapshot.etag });
  } catch (error) {
    console.error('Deal arrival comparison failed:', error);
    return NextResponse.json({ error: 'Cannot compare deal arrivals' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { eligibleIds, etag, date } = await req.json();
    if (!validIds(eligibleIds) || !validDate(date) || !(etag === null || (typeof etag === 'string' && etag.length <= 200))) {
      return NextResponse.json({ error: 'Invalid deal snapshot' }, { status: 400 });
    }
    const current = await readSnapshot();
    if (current.etag !== etag || (current.date && current.date > date)) {
      return NextResponse.json({ error: 'Snapshot changed; rerun comparison' }, { status: 409 });
    }
    try {
      await put(KEY, JSON.stringify({ eligibleIds: [...eligibleIds].sort(), date }), {
        access: 'private', contentType: 'application/json', token: token(), addRandomSuffix: false,
        allowOverwrite: etag !== null, cacheControlMaxAge: 0, ...(etag ? { ifMatch: etag } : {}),
      });
    } catch (error) {
      if ((error instanceof Error && error.name === 'BlobPreconditionFailedError') || (await readSnapshot()).etag !== etag) {
        return NextResponse.json({ error: 'Snapshot changed; rerun comparison' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Deal snapshot commit failed:', error);
    return NextResponse.json({ error: 'Cannot commit deal snapshot' }, { status: 500 });
  }
}
