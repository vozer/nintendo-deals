export interface NintendoGame {
  fs_id: string;
  title: string;
  image_url_sq_s: string;
  image_url_h2x1_s?: string;
  image_url_h16x9_s?: string;
  price_regular_f: number;
  price_discounted_f: number;
  price_discount_percentage_f: number;
  price_has_discount_b?: boolean;
  price_sorting_f?: number;
  excerpt: string;
  excerpt_language?: 'en' | 'es';
  url: string;
  pretty_game_categories_txt: string[];
  game_categories_txt?: string[];
  publisher: string;
  system_names_txt: string[];
  pretty_agerating_s: string;
  pretty_date_s: string;
  price_lowest_f: number;
}

export interface OfferEndDate {
  price_cents: number;
  end_datetime: string;
}

export interface OfferEndDatesSnapshot {
  checked_at: string | null;
  records: Record<string, OfferEndDate>;
}

export interface Preferences {
  hiddenGames: string[];
  watchGames: Record<
    string,
    { threshold: 2 | 5 | 10; title: string }
  >;
  thinkingAbout: string[];
}

export interface GamesResponse {
  games: NintendoGame[];
  total: number;
}

export type SortOption =
  | 'discount'
  | 'price_asc'
  | 'price_desc'
  | 'title'
  | 'popularity'
  | 'rating'
  | 'value';

export interface GameRating {
  igdb_id: number;
  total_rating: number | null;
  aggregated_rating: number | null;
  rating: number | null;
  rating_count: number;
  aggregated_rating_count: number;
  matched_title: string;
  confidence: number;
  last_updated: string;
}

export type RatingsMap = Record<string, GameRating>;

export interface GameMedia {
  screenshots: string[];
  videos: GameVideo[];
  igdb_url: string | null;
  source: 'nintendo' | 'igdb' | 'steam' | 'mixed';
  last_updated: string;
  asset_sources?: Record<string, 'nintendo' | 'igdb' | 'steam'>;
  steam_match?: { steam_id: number; matched_title: string; publisher: string; last_updated: string };
  igdb_match?: { igdb_id: number; matched_title: string; url: string; last_updated: string };
  legacy_igdb_url?: string;
  collection_complete?: boolean;
}

export interface GameVideo {
  video_id: string;
  name?: string;
  youtube_url?: string;
  thumbnail?: string;
  embed_url?: string;
  type: 'youtube' | 'limelight' | 'steam';
  source?: 'nintendo' | 'igdb' | 'steam';
  source_url?: string;
  content_url?: string;
  hls_url?: string;
}

export type MediaMap = Record<string, GameMedia>;

export interface SteamRating {
  steam_id: number;
  score_pct: number;
  votes: number;
  url: string;
  matched_title: string;
  tags?: string[];
  last_updated?: string;
  tags_updated_at?: string;
}

export type SteamRatingsMap = Record<string, SteamRating>;

export interface CuratedEntry {
  title: string;
  review: string;
  source_url: string;
  source?: 'nintendolife' | 'ntdeals';
  source_reference?: string;
  source_platform?: string;
  source_price_eur?: number;
  refreshed_at?: string;
  run_id?: string;
  rank?: number;
  metacritic_score?: number;
  discount_pct?: number;
  days_remaining?: number;
}

export type CuratedMap = Record<string, CuratedEntry>;

export interface CuratedSources {
  nintendolife: CuratedMap;
  ntdeals: CuratedMap;
}
