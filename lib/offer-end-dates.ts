import { NintendoGame, OfferEndDatesSnapshot } from './types';

const MAX_SOURCE_AGE_MS = 36 * 60 * 60 * 1000;

export function currentOfferEndDate(
  game: NintendoGame,
  snapshot: OfferEndDatesSnapshot,
  now = Date.now(),
): string | undefined {
  if (!snapshot.checked_at) return undefined;
  const checkedAt = Date.parse(snapshot.checked_at);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 5 * 60 * 1000 || now - checkedAt > MAX_SOURCE_AGE_MS) return undefined;
  if (game.price_has_discount_b !== true || !Number.isFinite(game.price_discounted_f)) return undefined;
  const record = snapshot.records[game.fs_id];
  if (!record || record.price_cents !== Math.round(game.price_discounted_f * 100)) return undefined;
  const end = Date.parse(record.end_datetime);
  return Number.isFinite(end) && end > now ? new Date(end).toISOString() : undefined;
}
