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
}): Promise<GamesResponse> {
  const { sort = 'popularity', search, start = 0, rows = 48 } = options;

  const q = search ? search.trim() : '*';

  const params = new URLSearchParams({
    q,
    fq: BASE_FILTER,
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
