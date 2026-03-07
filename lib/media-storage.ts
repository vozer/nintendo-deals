import { put, get as blobGet } from '@vercel/blob';
import { MediaMap } from './types';

const MEDIA_KEY = 'media.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getMedia(): Promise<MediaMap> {
  try {
    const token = getToken();
    const result = await blobGet(MEDIA_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return {};
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as MediaMap;
  } catch {
    return {};
  }
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
