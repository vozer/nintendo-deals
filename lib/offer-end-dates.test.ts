import { describe, expect, it } from 'vitest';
import { currentOfferEndDate } from './offer-end-dates';
import { NintendoGame } from './types';

const game = (extra: Partial<NintendoGame> = {}): NintendoGame => ({
  fs_id: '123', title: 'Game', image_url_sq_s: '', price_regular_f: 9.99, price_discounted_f: 4.99,
  price_discount_percentage_f: 50, price_has_discount_b: true, excerpt: '', url: '',
  pretty_game_categories_txt: [], publisher: '', system_names_txt: [], pretty_agerating_s: '',
  pretty_date_s: '', price_lowest_f: 4.99, ...extra,
});

describe('current official offer end date', () => {
  const snapshot = { checked_at: '2026-10-04T10:00:00Z', records: {
    '123': { price_cents: 499, end_datetime: '2026-10-14T21:59:59Z' },
  } };
  it('returns an end date only when it matches a fresh active discounted price', () => {
    const now = Date.parse('2026-10-04T11:00:00Z');
    expect(currentOfferEndDate(game(), snapshot, now)).toBe('2026-10-14T21:59:59.000Z');
    expect(currentOfferEndDate(game({ price_discounted_f: 3.99 }), snapshot, now)).toBeUndefined();
    expect(currentOfferEndDate(game({ price_has_discount_b: false }), snapshot, now)).toBeUndefined();
    expect(currentOfferEndDate(game({ price_has_discount_b: undefined }), snapshot, now)).toBeUndefined();
    expect(currentOfferEndDate(game({ fs_id: '999' }), snapshot, now)).toBeUndefined();
    expect(currentOfferEndDate(game(), { checked_at: null, records: {} }, now)).toBeUndefined();
  });

  it('omits missing, expired, and stale hook dates rather than inferring them', () => {
    const now = Date.parse('2026-10-14T22:00:00Z');
    expect(currentOfferEndDate(game(), snapshot, now)).toBeUndefined();
    expect(currentOfferEndDate(game(), { ...snapshot, checked_at: '2026-10-01T10:00:00Z' }, now)).toBeUndefined();
    expect(currentOfferEndDate(game(), { checked_at: snapshot.checked_at, records: {
      '123': { price_cents: 499, end_datetime: 'invalid' },
    } }, Date.parse('2026-10-04T11:00:00Z'))).toBeUndefined();
  });
});
