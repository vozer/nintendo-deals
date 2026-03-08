import { put, get as blobGet } from '@vercel/blob';
import { CuratedList } from './types';

const CURATED_KEY = 'curated.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getCuratedList(): Promise<CuratedList> {
  try {
    const token = getToken();
    const result = await blobGet(CURATED_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return [];
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as CuratedList;
  } catch {
    return [];
  }
}

export async function saveCuratedList(list: CuratedList): Promise<void> {
  await put(CURATED_KEY, JSON.stringify(list), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
