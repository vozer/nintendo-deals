import { GameRating, NintendoGame, RatingsMap, SteamRating } from './types';

const MIN_VOTES = 10;
export const CONFIDENT_THRESHOLD = 100;
export const SHOVELWARE_THRESHOLD = 6;

const SHOVELWARE_PUBLISHERS = new Set([
  'Dead Drop Studios', 'D3PUBLISHER', 'Ocean Media',
  'Pix Arts', 'Graffiti Games', 'Sabec',
]);

const KIDDIE_TAGS = new Set([
  'Educational', 'Kids', 'Family Friendly', 'Cute', 'Casual', 'Relaxing',
  'Colorful', 'Cartoony', 'Wholesome', 'Clicker', 'Match 3', 'Hidden Object',
  'Cats', 'Cozy', 'Simple',
]);
const CORE_TAGS = new Set([
  'Horror', 'Difficult', 'Story Rich', 'Atmospheric', 'Psychological Horror',
  'RPG', 'Shooter', 'Strategy', 'Dark', 'Sci-fi', 'Mystery', 'Survival',
  'Metroidvania', 'Souls-like', 'Action-Adventure', 'Hack and Slash',
  'Stealth', 'Tactical', 'Turn-Based Strategy', 'Management',
]);

export function computeShovelwareScore(
  game: NintendoGame,
  steam?: SteamRating,
  igdb?: GameRating,
): number {
  let score = 0;
  const tags = steam?.tags ?? [];
  const votes = steam?.votes ?? 0;
  const pct = steam?.score_pct ?? 0;

  if (votes > 0 && pct < 70) score += 2;
  else if (votes > 0 && pct < 80) score += 1;

  if (votes === 0) score += 3;
  else if (votes < 20) score += 3;
  else if (votes < 50) score += 2;
  else if (votes < 100) score += 1;

  const kidCount = tags.filter(t => KIDDIE_TAGS.has(t)).length;
  const coreCount = tags.filter(t => CORE_TAGS.has(t)).length;
  const kiddieNet = kidCount - coreCount;
  if (kiddieNet >= 3) score += 2;
  else if (kiddieNet >= 2) score += 1;

  if (game.price_discounted_f < 1.5) score += 1;
  else if (game.price_discounted_f < 3) score += 0.5;

  if (SHOVELWARE_PUBLISHERS.has(game.publisher)) score += 2;

  const cats = game.game_categories_txt ?? [];
  if (cats.includes('education')) score += 2;
  if (cats.includes('lifestyle')) score += 1;

  return score;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeGlobalMean(ratings: RatingsMap): number {
  let sum = 0;
  let count = 0;
  for (const r of Object.values(ratings)) {
    if (r.total_rating != null && r.rating_count > 0) {
      sum += r.total_rating;
      count++;
    }
  }
  return count > 0 ? sum / count : 70;
}

/**
 * Bayesian average: dampens ratings toward global mean based on review count.
 * B(r) = (v / (v + m)) * R + (m / (v + m)) * C
 * m=10 ensures games need ~10+ reviews to meaningfully diverge from mean.
 * Returns -1 for unrated games.
 */
export function bayesianScore(
  totalRating: number | null | undefined,
  ratingCount: number,
  globalMean: number,
): number {
  if (totalRating == null || totalRating < 0) return -1;
  const v = ratingCount;
  return (v / (v + MIN_VOTES)) * totalRating + (MIN_VOTES / (v + MIN_VOTES)) * globalMean;
}
