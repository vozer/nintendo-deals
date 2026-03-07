import { NintendoGame, GamesResponse, SortOption } from './types';

const NINTENDO_SOLR_URL = 'https://searching.nintendo-europe.com/es/select';

const BASE_FILTER = [
  'type:GAME',
  'system_type:nintendoswitch*',
  'price_has_discount_b:true',
  'price_sorting_f:[0 TO 14.99]',
  'language_availability:*english*',
  'digital_version_b:true',
].join(' AND ');

const SORT_MAP: Record<SortOption, string> = {
  discount: 'price_discount_percentage_f desc',
  price_asc: 'price_sorting_f asc',
  price_desc: 'price_sorting_f desc',
  title: 'sorting_title asc',
  popularity: 'popularity asc',
  rating: 'popularity asc',
  value: 'popularity asc',
};

export async function fetchDeals(options: {
  sort?: SortOption;
  search?: string;
  start?: number;
  rows?: number;
  tab?: string;
}): Promise<GamesResponse> {
  const { sort = 'popularity', search, start = 0, rows = 48, tab } = options;

  const q = search ? search.trim() : '*';

  let fq = BASE_FILTER;

  if (tab === 'sports') {
    fq += ' AND pretty_game_categories_txt:Deportes';
  } else if (tab === 'collections') {
    // No server-side filter — handled by search query for title words
  }

  const params = new URLSearchParams({
    q: tab === 'collections' && !search ? '(collection OR bundle OR "in 1" OR "mega pack")' : q,
    fq,
    sort: SORT_MAP[sort] || SORT_MAP.popularity,
    start: String(start),
    rows: String(rows),
    wt: 'json',
  });

  const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Nintendo API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    games: data.response.docs as NintendoGame[],
    total: data.response.numFound as number,
  };
}
