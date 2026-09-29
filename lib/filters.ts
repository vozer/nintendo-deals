import { NintendoGame } from './types';
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
