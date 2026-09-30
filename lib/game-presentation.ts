import { GameMedia, GameVideo, SteamRating } from './types';

export function mergeVideos(previous: GameVideo[], updates: GameVideo[]): GameVideo[] {
  const videos = new Map<string, GameVideo>();
  for (const video of [...previous, ...updates]) {
    const key = `${video.type}:${video.video_id}`;
    videos.set(key, { ...videos.get(key), ...Object.fromEntries(Object.entries(video).filter(([, value]) => value !== undefined && value !== '')) } as GameVideo);
  }
  return [...videos.values()];
}

const CATEGORIES: Record<string, string> = {
  'Acción': 'Action', 'Aventura': 'Adventure', 'Rol (RPG)': 'RPG',
  'Puzle': 'Puzzle', 'Plataformas': 'Platformer', 'Arcade': 'Arcade',
  'Deportes': 'Sports', 'Estrategia': 'Strategy', 'Simulación': 'Simulation',
  'Carreras': 'Racing', 'Disparos (Shooter)': 'Shooter', 'Fiesta': 'Party',
  'Lucha': 'Fighting', 'Música': 'Music', 'Tablero': 'Board Game',
  'Otros': 'Other', 'Salud y forma física': 'Fitness',
};

export function translateCategory(category: string): string {
  return CATEGORIES[category] || (Object.values(CATEGORIES).includes(category) ? category : 'Other');
}

export function steamLink(steam?: SteamRating, media?: GameMedia): string | undefined {
  const id = media?.steam_match?.steam_id ?? steam?.steam_id;
  return Number.isSafeInteger(id) && Number(id) > 0 ? `https://store.steampowered.com/app/${id}/` : undefined;
}

export function nintendoLink(path: string): string | undefined {
  try {
    const url = new URL(path, 'https://www.nintendo.com');
    return url.protocol === 'https:' && url.hostname === 'www.nintendo.com' && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch { return undefined; }
}

export function mediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && [
      'nintendo.com', 'nintendo.net', 'nintendo.eu', 'igdb.com',
      'steamstatic.com', 'steamcontent.com', 'steampowered.com', 'ytimg.com',
    ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function releaseDate(value: string): string {
  if (!value) return '';
  // Nintendo supplies dd/MM/yyyy as well as ISO dates.
  const european = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const date = new Date(european ? `${european[3]}-${european[2]}-${european[1]}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
