import { NintendoGame, GamesResponse, SortOption } from './types';

const NINTENDO_SOLR_URL = 'https://searching.nintendo-europe.com/es/select';

const DEALS_FILTER = [
  'type:GAME',
  'system_type:nintendoswitch*',
  'price_has_discount_b:true',
  'price_sorting_f:[0 TO 14.99]',
  'language_availability:*english*',
].join(' AND ');

const SEARCH_FILTER = [
  'type:GAME',
  'system_type:nintendoswitch*',
  'language_availability:*english*',
].join(' AND ');

function escapeSolr(query: string): string {
  return query.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

const SORT_MAP: Record<SortOption, string> = {
  discount: 'price_discount_percentage_f desc',
  price_asc: 'price_sorting_f asc',
  price_desc: 'price_sorting_f desc',
  title: 'sorting_title asc',
  popularity: 'popularity asc',
  rating: 'popularity asc',
  value: 'popularity asc',
};

const SOLR_MAX_ROWS = 1000;

export async function fetchDeals(options: {
  sort?: SortOption;
  search?: string;
  start?: number;
  rows?: number;
  tab?: string;
}): Promise<GamesResponse> {
  const { sort = 'popularity', search, start = 0, rows = 48, tab } = options;

  const isSearch = !!search?.trim();

  if (isSearch) {
    return fetchSearchResults(search!.trim(), rows);
  }

  let fq = DEALS_FILTER;

  if (tab === 'sports') {
    fq += ' AND pretty_game_categories_txt:Deportes';
  }

  const baseQ = tab === 'collections' ? '(collection OR bundle OR "in 1" OR "mega pack")' : '*';
  const sortStr = SORT_MAP[sort] || SORT_MAP.popularity;

  if (rows <= SOLR_MAX_ROWS) {
    const params = new URLSearchParams({
      q: baseQ, fq, sort: sortStr,
      start: String(start), rows: String(rows), wt: 'json',
    });
    const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Nintendo API error: ${res.status}`);
    const data = await res.json();
    return { games: data.response.docs as NintendoGame[], total: data.response.numFound as number };
  }

  const allGames: NintendoGame[] = [];
  let total = 0;
  let offset = start;

  while (allGames.length < rows) {
    const batch = Math.min(SOLR_MAX_ROWS, rows - allGames.length);
    const params = new URLSearchParams({
      q: baseQ, fq, sort: sortStr,
      start: String(offset), rows: String(batch), wt: 'json',
    });
    const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Nintendo API error: ${res.status}`);
    const data = await res.json();
    total = data.response.numFound as number;
    const docs = data.response.docs as NintendoGame[];
    allGames.push(...docs);
    if (docs.length < batch || allGames.length >= total) break;
    offset += docs.length;
  }

  return { games: allGames, total };
}

async function fetchSearchResults(query: string, maxRows: number): Promise<GamesResponse> {
  const escaped = escapeSolr(query);
  const rows = Math.min(maxRows, 100);

  const params = new URLSearchParams({
    defType: 'edismax',
    q: escaped,
    qf: 'title^3 title_extras_txt^2 title_master_s^3',
    pf: 'title^10 title_extras_txt^5 title_master_s^10',
    fq: SEARCH_FILTER,
    rows: String(rows),
    wt: 'json',
  });

  const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Nintendo API error: ${res.status}`);
  const data = await res.json();
  return { games: data.response.docs as NintendoGame[], total: data.response.numFound as number };
}
