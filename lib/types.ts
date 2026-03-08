export interface NintendoGame {
  fs_id: string;
  title: string;
  image_url_sq_s: string;
  image_url_h2x1_s?: string;
  image_url_h16x9_s?: string;
  price_regular_f: number;
  price_discounted_f: number;
  price_discount_percentage_f: number;
  excerpt: string;
  url: string;
  pretty_game_categories_txt: string[];
  publisher: string;
  system_names_txt: string[];
  pretty_agerating_s: string;
  pretty_date_s: string;
  price_lowest_f: number;
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
  source: 'nintendo' | 'igdb';
  last_updated: string;
}

export interface GameVideo {
  video_id: string;
  name?: string;
  youtube_url?: string;
  thumbnail?: string;
  embed_url?: string;
  type: 'youtube' | 'limelight';
}

export type MediaMap = Record<string, GameMedia>;

export interface SteamRating {
  steam_id: number;
  score_pct: number;
  votes: number;
  url: string;
  matched_title: string;
}

export type SteamRatingsMap = Record<string, SteamRating>;

export type CuratedList = string[]; // List of curated game titles (fs_id is harder to match from external sites)
