import { put, get as blobGet } from '@vercel/blob';
import { RatingsMap } from './types';

const RATINGS_KEY = 'ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getRatings(): Promise<RatingsMap> {
  try {
    const token = getToken();
    const result = await blobGet(RATINGS_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return {};
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as RatingsMap;
  } catch {
    return {};
  }
}

export async function saveRatings(ratings: RatingsMap): Promise<void> {
  await put(RATINGS_KEY, JSON.stringify(ratings), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
