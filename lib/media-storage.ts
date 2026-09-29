import { put } from '@vercel/blob';
import { MediaMap } from './types';
import { readPrivateJsonMap } from './blob-json';

const MEDIA_KEY = 'media.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getMedia(): Promise<MediaMap> {
  return readPrivateJsonMap<MediaMap>(MEDIA_KEY, getToken());
}

export async function saveMedia(media: MediaMap): Promise<void> {
  await put(MEDIA_KEY, JSON.stringify(media), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
