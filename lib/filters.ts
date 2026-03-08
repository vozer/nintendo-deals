import { NintendoGame } from './types';

const BLOCKED_TITLE_RE = /\b(hentai)\b/i;
const DATING_CONTEXT_RE = /\b(dating|dates?\s+(boys?|girls?|sim|everything|simulator|z\b)|date\s+(z|everything)|blind\s+dates?|love\s+&?\s*horoscope\s+dating|sexy\s+halloween|romantic\s+date|romantic\b.*\bdate|date\s+with\b|zodiac\s+date|romance\b.*\b(boys?|anime)|boyfriend|girlfriend|otome|waifu|harem)\b/i;
const COLLECTION_RE = /\b(collection|bundle|\d+\s*in\s*1|mega\s+pack)\b/i;
const SPORTS_CATEGORY = 'Deportes';

export type GameClassification = 'deals' | 'collections' | 'sports' | 'blocked';

export function classifyGame(game: NintendoGame): GameClassification {
  const title = game.title;

  if (BLOCKED_TITLE_RE.test(title)) return 'blocked';
  if (DATING_CONTEXT_RE.test(title)) return 'blocked';

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
