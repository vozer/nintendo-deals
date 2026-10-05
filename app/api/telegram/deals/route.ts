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
type OfferState = { active: boolean; price_cents: number; episode: number; price_change_sequence: number };
type OfferTransition = { fs_id: string; kind: 'new' | 'price_changed' | 'reentered'; previous_price_cents: number | null;
  price_cents: number; episode: number; price_change_sequence: number };
const validOffers = (offers: unknown): offers is Record<string, OfferState> => !!offers
  && typeof offers === 'object' && !Array.isArray(offers)
  && Object.entries(offers as Record<string, unknown>).length <= 20000
  && Object.entries(offers as Record<string, unknown>).every(([id, value]) => !!/^\d+$/.test(id)
    && !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as OfferState).active === 'boolean'
    && Number.isSafeInteger((value as OfferState).price_cents) && (value as OfferState).price_cents >= 0
    && Number.isSafeInteger((value as OfferState).episode) && (value as OfferState).episode >= 1
    && Number.isSafeInteger((value as OfferState).price_change_sequence) && (value as OfferState).price_change_sequence >= 0);
const validDate = (date: unknown): date is string => typeof date === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

async function readSnapshot() {
  const result = await blobGet(KEY, { access: 'private', token: token(), useCache: false,
    headers: { 'Accept-Encoding': 'identity' } });
  if (!result) return { eligibleIds: [] as string[], offers: null as Record<string, OfferState> | null,
    etag: null as string | null, date: null as string | null };
  if (result.statusCode !== 200) throw new Error('Unexpected deal snapshot response');
  const value = JSON.parse(await new Response(result.stream).text());
  if (!validIds(value?.eligibleIds) || !validDate(value?.date)
    || (value.offers !== undefined && !validOffers(value.offers))) throw new Error('Invalid deal snapshot');
  return { eligibleIds: value.eligibleIds as string[], offers: validOffers(value.offers) ? value.offers : null,
    etag: result.blob.etag as string | null, date: value.date as string | null };
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
    if (!Array.isArray(games) || !Number.isInteger(total) || total < 0 || total > 20000
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
    const previousEligible = new Set(snapshot.eligibleIds);
    const newIds = snapshot.etag === null ? [] : eligibleIds.filter(id => !previousEligible.has(id));
    const currentById = new Map((games as Array<NintendoGame & { system_type: string[] }>).filter(game =>
      game.system_type.some(system => system.startsWith(policy.switchSystemPrefix))
      && !game.system_type.includes(policy.excludedSystemType)
      && game.price_has_discount_b && game.price_discounted_f >= 0 && game.price_discounted_f <= policy.maxDiscountedPriceEur
    ).map(game => [game.fs_id, game]));
    const offers: Record<string, OfferState> = snapshot.offers ? structuredClone(snapshot.offers) : {};
    for (const [id, state] of Object.entries(offers)) {
      if (state.active && !currentById.has(id)) offers[id] = { ...state, active: false };
    }
    const baseline = snapshot.offers === null;
    const events: OfferTransition[] = [];
    for (const [id, game] of currentById) {
      const price_cents = Math.round(game.price_discounted_f * 100);
      const previous = offers[id];
      if (baseline || !previous) {
        offers[id] = { active: true, price_cents, episode: 1, price_change_sequence: 0 };
        continue;
      }
      if (!previous.active) {
        const next = { active: true, price_cents, episode: previous.episode + 1, price_change_sequence: 0 };
        offers[id] = next;
        events.push({ fs_id: id, kind: 'reentered', previous_price_cents: previous.price_cents,
          price_cents, episode: next.episode, price_change_sequence: next.price_change_sequence });
        continue;
      }
      if (previous.price_cents !== price_cents) {
        const next = { ...previous, active: true, price_cents, price_change_sequence: previous.price_change_sequence + 1 };
        offers[id] = next;
        events.push({ fs_id: id, kind: 'price_changed', previous_price_cents: previous.price_cents,
          price_cents, episode: next.episode, price_change_sequence: next.price_change_sequence });
        continue;
      }
      offers[id] = { ...previous, active: true };
    }
    if (baseline) {
      for (const game of currentById.values()) offers[game.fs_id] = { active: true,
        price_cents: Math.round(game.price_discounted_f * 100), episode: 1, price_change_sequence: 0 };
    }
    return NextResponse.json({ eligibleIds, newIds, events, offers, baseline,
      initialized: snapshot.etag !== null, etag: snapshot.etag });
  } catch (error) {
    console.error('Deal arrival comparison failed:', error);
    return NextResponse.json({ error: 'Cannot compare deal arrivals' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { eligibleIds, offers, etag, date } = await req.json();
    if (!validIds(eligibleIds) || (offers !== undefined && !validOffers(offers)) || !validDate(date)
      || !(etag === null || (typeof etag === 'string' && etag.length <= 200))) {
      return NextResponse.json({ error: 'Invalid deal snapshot' }, { status: 400 });
    }
    const current = await readSnapshot();
    if (current.etag !== etag || (current.date && current.date > date)) {
      return NextResponse.json({ error: 'Snapshot changed; rerun comparison' }, { status: 409 });
    }
    try {
      await put(KEY, JSON.stringify({ eligibleIds: [...eligibleIds].sort(), ...(offers !== undefined ? { offers } : {}), date }), {
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
