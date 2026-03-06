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
    { threshold: 5 | 10; title: string }
  >;
}

export interface GamesResponse {
  games: NintendoGame[];
  total: number;
}

export type SortOption = 'discount' | 'price_asc' | 'price_desc' | 'title' | 'popularity';

export interface PreferenceAction {
  action: 'hide' | 'unhide' | 'watch' | 'unwatch';
  gameId: string;
  threshold?: 5 | 10;
  title?: string;
}
