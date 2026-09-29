import { put, get as blobGet } from '@vercel/blob';
import { CuratedMap, CuratedSources } from './types';

const SOURCE_KEYS = {
  nintendolife: 'curated-nintendolife.json',
  ntdeals: 'curated-ntdeals.json',
} as const;
const LEGACY_KEY = 'curated.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

async function readMap(key: string): Promise<CuratedMap | null> {
  const result = await blobGet(key, { access: 'private', token: getToken(), useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200) throw new Error(`Unexpected ${key} blob response`);
  const value: unknown = JSON.parse(await new Response(result.stream).text());
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${key} document`);
  }
  return value as CuratedMap;
}

function entriesForSource(map: CuratedMap | null, source: keyof CuratedSources): CuratedMap {
  if (!map) return {};
  return Object.fromEntries(Object.entries(map).filter(([, entry]) => entry?.source === source));
}

export async function getCuratedSources(): Promise<CuratedSources> {
  const [nintendolife, ntdeals] = await Promise.all([
    readMap(SOURCE_KEYS.nintendolife),
    readMap(SOURCE_KEYS.ntdeals),
  ]);
  if (nintendolife && ntdeals) return { nintendolife, ntdeals };

  const legacy = await readMap(LEGACY_KEY);
  return {
    nintendolife: nintendolife ?? entriesForSource(legacy, 'nintendolife'),
    ntdeals: ntdeals ?? entriesForSource(legacy, 'ntdeals'),
  };
}

export async function saveCuratedSource(
  source: keyof CuratedSources,
  entries: CuratedMap,
): Promise<void> {
  await put(SOURCE_KEYS[source], JSON.stringify(entries), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
