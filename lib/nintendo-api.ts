import { NintendoGame, GamesResponse, SortOption } from './types';
import contentPolicy from '@/shared/content-policy.json';

const NINTENDO_SOLR_URL = 'https://searching.nintendo-europe.com/es/select';
const ORIGINAL_SWITCH_FILTER = `system_type:${contentPolicy.switchSystemPrefix}* AND -system_type:${contentPolicy.excludedSystemType}`;

const DEALS_FILTER = [
  'type:GAME',
  ORIGINAL_SWITCH_FILTER,
  'price_has_discount_b:true',
  `price_discounted_f:[0 TO ${contentPolicy.maxDiscountedPriceEur}]`,
  'language_availability:*english*',
].join(' AND ');

const SEARCH_FILTER = [
  'type:GAME',
  ORIGINAL_SWITCH_FILTER,
  'language_availability:*english*',
].join(' AND ');

function escapeSolr(query: string): string {
  return query.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

function isWithinDealPriceCap(game: NintendoGame): boolean {
  const price = Number(game.price_discounted_f);
  return Number.isFinite(price) && price >= 0 && price <= contentPolicy.maxDiscountedPriceEur;
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

async function withEnglishCopy(games: NintendoGame[]): Promise<NintendoGame[]> {
  const english = new Map<string, string>();
  const ids = [...new Set(games.map((game) => String(game.fs_id)).filter((id) => /^\d{1,20}$/.test(id)))].sort();
  const readBatch = async (batch: string[]) => {
    const params = new URLSearchParams({ q: '*', fq: `type:GAME AND ${ORIGINAL_SWITCH_FILTER} AND fs_id:(${batch.join(' OR ')})`, rows: String(batch.length), wt: 'json', fl: 'fs_id,excerpt' });
    try {
      const response = await fetch(`https://searching.nintendo-europe.com/en/select?${params}`, {
        next: { revalidate: 3600 }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const data = await response.json();
      for (const doc of data?.response?.docs ?? []) {
        if (batch.includes(String(doc.fs_id)) && typeof doc.excerpt === 'string' && doc.excerpt.trim()) {
          english.set(String(doc.fs_id), doc.excerpt.trim());
        }
      }
    } catch {
      // English presentation is optional; never lose Spanish offers during a source outage.
    }
  };
  for (let start = 0; start < ids.length; start += 400) {
    await Promise.all([0, 100, 200, 300].map((offset) => ids.slice(start + offset, start + offset + 100)).filter((batch) => batch.length).map(readBatch));
  }
  return games.map((game) => ({ ...game, excerpt: english.get(String(game.fs_id)) || game.excerpt, excerpt_language: english.has(String(game.fs_id)) ? 'en' : 'es' }));
}

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
    return fetchSearchResults(search!.trim(), start, rows);
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
    const games = (data.response.docs as NintendoGame[]).filter(isWithinDealPriceCap);
    return { games: await withEnglishCopy(games), total: data.response.numFound as number };
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
    allGames.push(...docs.filter(isWithinDealPriceCap));
    if (docs.length < batch || allGames.length >= total) break;
    offset += docs.length;
  }

  return { games: await withEnglishCopy(allGames), total };
}

export async function fetchGameById(fsId: string): Promise<NintendoGame | null> {
  const normalizedId = String(fsId || '').trim();
  if (!/^\d+$/.test(normalizedId)) return null;

  const fq = [
    'type:GAME',
    ORIGINAL_SWITCH_FILTER,
    `fs_id:${normalizedId}`,
  ].join(' AND ');

  const params = new URLSearchParams({
    q: '*',
    fq,
    rows: '1',
    wt: 'json',
  });

  const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Nintendo API error: ${res.status}`);

  const data = await res.json();
  const doc = (data?.response?.docs || [])[0] as NintendoGame | undefined;
  return doc ? (await withEnglishCopy([doc]))[0] : null;
}

async function fetchSearchResults(query: string, start: number, maxRows: number): Promise<GamesResponse> {
  const escaped = escapeSolr(query);
  const rows = Math.min(maxRows, 100);

  const params = new URLSearchParams({
    defType: 'edismax',
    q: escaped,
    qf: 'title^3 title_extras_txt^2 title_master_s^3',
    pf: 'title^10 title_extras_txt^5 title_master_s^10',
    fq: SEARCH_FILTER,
    start: String(start),
    rows: String(rows),
    wt: 'json',
  });

  const res = await fetch(`${NINTENDO_SOLR_URL}?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Nintendo API error: ${res.status}`);
  const data = await res.json();
  return { games: await withEnglishCopy(data.response.docs as NintendoGame[]), total: data.response.numFound as number };
}
