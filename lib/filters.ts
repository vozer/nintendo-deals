import { NintendoGame, GameRating, SteamRating, Preferences } from './types';
import { computeShovelwareScore, SHOVELWARE_THRESHOLD, CONFIDENT_THRESHOLD } from './sort-utils';
import contentPolicy from '@/shared/content-policy.json';

const BLOCKED_TITLE_RES = contentPolicy.blockedTitlePatterns.map(pattern => new RegExp(pattern, 'i'));
const BLOCKED_STEAM_TAGS = new Set(['Hentai', 'NSFW', 'Dating Sim', 'Otome']);

export function isBlockedTitle(title: string): boolean {
  return BLOCKED_TITLE_RES.some(pattern => pattern.test(title));
}

export function hasBlockedSteamTags(tags?: string[]): boolean {
  if (!tags) return false;
  return tags.some(t => BLOCKED_STEAM_TAGS.has(t));
}
const COLLECTION_RE = /\b(collection|bundle|\d+\s*in\s*1|mega\s+pack)\b/i;
const SPORTS_CATEGORY = 'Deportes';

export type GameClassification = 'deals' | 'collections' | 'sports' | 'blocked';

export function classifyGame(game: NintendoGame): GameClassification {
  const title = game.title;

  if (isBlockedTitle(title)) return 'blocked';

  if (COLLECTION_RE.test(title)) return 'collections';

  const categories = game.pretty_game_categories_txt || [];
  if (categories.includes(SPORTS_CATEGORY)) return 'sports';

  return 'deals';
}

export function isHomepageDeal(game: NintendoGame, preferences: Preferences,
  rating: GameRating | undefined, steam: SteamRating | undefined, curated: boolean): boolean {
  const watch = preferences.watchGames[game.fs_id];
  return classifyGame(game) === 'deals'
    && !preferences.hiddenGames.includes(game.fs_id)
    && !preferences.thinkingAbout?.includes(game.fs_id)
    && !(watch && game.price_discounted_f >= watch.threshold)
    && !hasBlockedSteamTags(steam?.tags)
    && computeShovelwareScore(game, steam) < SHOVELWARE_THRESHOLD
    && (curated || (rating?.rating_count ?? 0) + (steam?.votes ?? 0) >= CONFIDENT_THRESHOLD);
}

export function classifyGames(
  games: NintendoGame[],
): Record<GameClassification, NintendoGame[]> {
  const result: Record<GameClassification, NintendoGame[]> = {
    deals: [],
    collections: [],
    sports: [],
    blocked: [],
  };
  for (const game of games) {
    result[classifyGame(game)].push(game);
  }
  return result;
}
