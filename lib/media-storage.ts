import { MediaMap } from './types';
import { readPrivateJsonMap, updatePrivateJsonMap } from './blob-json';
import { mergeVideos } from './game-presentation';

const MEDIA_KEY = 'media.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getMedia(): Promise<MediaMap> {
  return readPrivateJsonMap<MediaMap>(MEDIA_KEY, getToken());
}

export async function saveMedia(media: MediaMap, revision?: string): Promise<void> {
  await updatePrivateJsonMap(MEDIA_KEY, media, getToken(), revision, (old, next) => ({
    ...old, ...next,
    screenshots: [...new Set([...(old?.screenshots ?? []), ...next.screenshots])],
    videos: mergeVideos(old?.videos ?? [], next.videos),
    asset_sources: { ...old?.asset_sources, ...next.asset_sources },
  }));
}
