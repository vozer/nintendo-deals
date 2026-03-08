import { put, get as blobGet } from '@vercel/blob';
import { CuratedMap } from './types';

const CURATED_KEY = 'curated.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getCuratedMap(): Promise<CuratedMap> {
  try {
    const token = getToken();
    const result = await blobGet(CURATED_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return {};
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as CuratedMap;
  } catch {
    return {};
  }
}

export async function saveCuratedMap(map: CuratedMap): Promise<void> {
  await put(CURATED_KEY, JSON.stringify(map), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
