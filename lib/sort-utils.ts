import { RatingsMap } from './types';

const MIN_VOTES = 5;

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
