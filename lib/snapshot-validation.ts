import { MediaMap, RatingsMap, SteamRatingsMap } from './types';
import { mediaUrl } from './game-presentation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isGameMap(value: unknown, validEntry: (entry: unknown) => boolean): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 50_000 && entries.every(
    ([fsId, entry]) => /^\d{1,20}$/.test(fsId) && validEntry(entry),
  );
}

export function isRatingsSnapshot(value: unknown): value is RatingsMap {
  return isGameMap(value, (raw) => {
    if (!isRecord(raw)) return false;
    const boundedScore = (score: unknown) => score === null || (
      typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
    );
    return Number.isSafeInteger(raw.igdb_id) && Number(raw.igdb_id) > 0
      && boundedScore(raw.total_rating)
      && boundedScore(raw.aggregated_rating)
      && boundedScore(raw.rating)
      && Number.isSafeInteger(raw.rating_count) && Number(raw.rating_count) >= 0
      && Number.isSafeInteger(raw.aggregated_rating_count) && Number(raw.aggregated_rating_count) >= 0
      && typeof raw.matched_title === 'string' && raw.matched_title.trim().length > 0
      && typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 100
      && typeof raw.last_updated === 'string'
      && (raw.release_date === undefined || raw.release_date === null || typeof raw.release_date === 'string');
  });
}

export function isMediaSnapshot(value: unknown): value is MediaMap {
  return isGameMap(value, (raw) => isRecord(raw)
    && Array.isArray(raw.screenshots)
    && raw.screenshots.every(mediaUrl)
    && Array.isArray(raw.videos)
    && raw.videos.every((video) => isRecord(video)
      && typeof video.video_id === 'string' && video.video_id.length > 0
      && ['youtube', 'limelight', 'steam'].includes(String(video.type))
      && (video.source === undefined || ['nintendo', 'igdb', 'steam'].includes(String(video.source)))
      && (video.type !== 'youtube' || /^[\w-]{11}$/.test(video.video_id))
      && [video.thumbnail, video.source_url, video.content_url, video.hls_url].every((url) => url === undefined || url === '' || mediaUrl(url))
      && (video.youtube_url === undefined || (video.type === 'youtube' && video.youtube_url === `https://www.youtube.com/embed/${video.video_id}`))
      && (video.type !== 'steam' || (/^\d+$/.test(video.video_id) && isRecord(raw.steam_match) && video.source_url === `https://store.steampowered.com/app/${raw.steam_match.steam_id}/`)))
    && (raw.igdb_url === null || raw.igdb_url === undefined || isUrl(raw.igdb_url))
    && ['nintendo', 'igdb', 'steam', 'mixed'].includes(String(raw.source))
    && typeof raw.last_updated === 'string'
    && (raw.collection_complete === undefined || typeof raw.collection_complete === 'boolean')
    && (raw.asset_sources === undefined || (isRecord(raw.asset_sources) && Object.entries(raw.asset_sources).every(([url, source]) => mediaUrl(url) && ['nintendo', 'igdb', 'steam'].includes(String(source)))))
    && (raw.steam_match === undefined || (isRecord(raw.steam_match)
      && Number.isSafeInteger(raw.steam_match.steam_id) && Number(raw.steam_match.steam_id) > 0
      && typeof raw.steam_match.matched_title === 'string' && raw.steam_match.matched_title.trim().length > 0
      && typeof raw.steam_match.publisher === 'string' && typeof raw.steam_match.last_updated === 'string')));
}

export function isSteamSnapshot(value: unknown): value is SteamRatingsMap {
  return isGameMap(value, (raw) => isRecord(raw)
    && Number.isSafeInteger(raw.steam_id) && Number(raw.steam_id) > 0
    && Number.isInteger(raw.score_pct) && Number(raw.score_pct) >= 0 && Number(raw.score_pct) <= 100
    && Number.isSafeInteger(raw.votes) && Number(raw.votes) >= 0
    && raw.url === `https://store.steampowered.com/app/${raw.steam_id}/`
    && typeof raw.matched_title === 'string' && raw.matched_title.trim().length > 0
    && (raw.last_updated === undefined || typeof raw.last_updated === 'string')
    && (raw.tags_updated_at === undefined || typeof raw.tags_updated_at === 'string')
    && (raw.tags === undefined || (Array.isArray(raw.tags)
      && raw.tags.length <= 30
      && raw.tags.every((tag) => typeof tag === 'string' && tag.length <= 100))));
}
