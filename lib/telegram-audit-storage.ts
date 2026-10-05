import { createHash } from 'node:crypto';
import { get as blobGet, list as blobList, put } from '@vercel/blob';

const MAX_RECORD_BYTES = 256_000;
const MAX_WRITE_ATTEMPTS = 3;
const MAX_AUDIT_SCAN = 500;
const SENSITIVE_KEY = /(token|secret|authorization|cookie|password|api[_-]?key)/i;
const BOT_URL = /https:\/\/api\.telegram\.org\/bot[^/\s"']+/gi;
const BOT_TOKEN = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g;

export type TelegramAuditEvent = {
  event_id: string;
  occurred_at: string;
  direction: 'inbound' | 'outbound' | 'internal';
  kind: string;
  correlation_id?: string;
  request?: unknown;
  response?: unknown;
};

export type TelegramDeliveryOutcome = 'sent' | 'rejected' | 'unknown';
export type TelegramAuditFilters = {
  direction?: 'inbound' | 'outbound' | 'internal';
  kind?: string;
  correlation_id?: string;
  q?: string;
};

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function redact(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return value.replace(BOT_URL, 'https://api.telegram.org/bot[REDACTED]')
    .replace(BOT_TOKEN, '[REDACTED]');
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => redact(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 500)
      .map(([childKey, child]) => [childKey, redact(child, childKey, depth + 1)]));
  }
  return value;
}

function recordPath(event: TelegramAuditEvent): string {
  const time = new Date(event.occurred_at);
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid Telegram audit timestamp');
  const day = time.toISOString().slice(0, 10);
  const name = `${time.toISOString().replace(/[:.]/g, '-')}-${digest(event.event_id)}.json`;
  return `telegram-audit/${day}/${name}`;
}

export async function appendTelegramAuditEvent(event: TelegramAuditEvent): Promise<{ created: boolean }> {
  if (!event || typeof event.event_id !== 'string' || event.event_id.length < 1 || event.event_id.length > 500
    || !['inbound', 'outbound', 'internal'].includes(event.direction)
    || typeof event.kind !== 'string' || !/^[a-z0-9._-]{1,80}$/i.test(event.kind)
    || typeof event.occurred_at !== 'string') throw new Error('Invalid Telegram audit event');

  const safeEvent = redact(event) as TelegramAuditEvent;
  const body = JSON.stringify(safeEvent);
  if (Buffer.byteLength(body, 'utf8') > MAX_RECORD_BYTES) throw new Error('Telegram audit record is too large');
  const pathname = recordPath(event);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await put(pathname, body, {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        allowOverwrite: false, cacheControlMaxAge: 0, token: blobToken(),
      });
      return { created: true };
    } catch (error) {
      const existing = await blobGet(pathname, { access: 'private', token: blobToken(), useCache: false });
      if (existing?.statusCode === 200) return { created: false };
      const conflict = error instanceof Error && /precondition|already exists/i.test(`${error.name} ${error.message}`);
      if (!conflict || attempt === MAX_WRITE_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error('Could not append Telegram audit event');
}

function matchesAuditFilter(event: TelegramAuditEvent, filters: TelegramAuditFilters): boolean {
  if (filters.direction && event.direction !== filters.direction) return false;
  if (filters.kind && event.kind !== filters.kind) return false;
  if (filters.correlation_id && event.correlation_id !== filters.correlation_id) return false;
  if (filters.q && !JSON.stringify(event).toLocaleLowerCase().includes(filters.q.toLocaleLowerCase())) return false;
  return true;
}

export async function listTelegramAuditEvents(
  date: string,
  cursor: string | undefined,
  limit: number,
  filters: TelegramAuditFilters = {},
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (cursor !== undefined && (cursor.length > 3000 || !/^[\x21-\x7E]+$/.test(cursor)))
    || (filters.direction !== undefined && !['inbound', 'outbound', 'internal'].includes(filters.direction))
    || (filters.kind !== undefined && !/^[a-z0-9._-]{1,80}$/i.test(filters.kind))
    || (filters.correlation_id !== undefined && (filters.correlation_id.length < 1 || filters.correlation_id.length > 200))
    || (filters.q !== undefined && (filters.q.length < 1 || filters.q.length > 100))) {
    throw new Error('Invalid Telegram audit query');
  }
  let nextCursor = cursor;
  let scanned = 0;
  let hasMore = true;
  const events: TelegramAuditEvent[] = [];
  while (events.length < limit && scanned < MAX_AUDIT_SCAN && hasMore) {
    const pageLimit = Math.min(100, limit - events.length, MAX_AUDIT_SCAN - scanned);
    const page = await blobList({ prefix: `telegram-audit/${date}/`, cursor: nextCursor, limit: pageLimit, token: blobToken() });
    const pageEvents = await Promise.all(page.blobs.map(async blob => {
      const result = await blobGet(blob.pathname, { access: 'private', token: blobToken(), useCache: false });
      if (!result || result.statusCode !== 200) throw new Error('Telegram audit record is unavailable');
      return JSON.parse(await new Response(result.stream).text()) as TelegramAuditEvent;
    }));
    events.push(...pageEvents.filter(event => matchesAuditFilter(event, filters)));
    scanned += page.blobs.length;
    hasMore = page.hasMore;
    nextCursor = page.cursor ?? undefined;
    if (page.blobs.length === 0) hasMore = false;
    if (hasMore && !nextCursor) throw new Error('Telegram audit pagination cursor is unavailable');
  }
  events.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  return { events: events.slice(0, limit), cursor: hasMore ? nextCursor ?? null : null, hasMore, scanned };
}

function deliveryPath(eventId: string, suffix: 'claim' | 'result'): string {
  const hash = digest(eventId);
  return `telegram-deliveries/${hash.slice(0, 2)}/${hash}.${suffix}.json`;
}

async function readPrivateJson(pathname: string): Promise<Record<string, unknown> | null> {
  const result = await blobGet(pathname, { access: 'private', token: blobToken(), useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200) throw new Error('Unexpected Telegram delivery response');
  const value = JSON.parse(await new Response(result.stream).text());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Telegram delivery record');
  return value as Record<string, unknown>;
}

async function appendPrivateJson(pathname: string, value: Record<string, unknown>): Promise<boolean> {
  try {
    await put(pathname, JSON.stringify(value), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
      allowOverwrite: false, cacheControlMaxAge: 0, token: blobToken(),
    });
    return true;
  } catch (error) {
    if (await readPrivateJson(pathname)) return false;
    throw error;
  }
}

export async function claimTelegramDelivery(eventId: string, metadata: Record<string, unknown> = {}) {
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 500) throw new Error('Invalid delivery event ID');
  const pathname = deliveryPath(eventId, 'claim');
  const claim = { event_id: eventId, claimed_at: new Date().toISOString(), metadata: redact(metadata) };
  const claimed = await appendPrivateJson(pathname, claim);
  const result = await readPrivateJson(deliveryPath(eventId, 'result'));
  if (!claimed && result?.outcome !== 'sent') return { claimed: false, outcome: result?.outcome ?? 'unknown' };
  return { claimed, outcome: result?.outcome ?? null, message_id: result?.message_id ?? null };
}

export async function completeTelegramDelivery(
  eventId: string,
  outcome: TelegramDeliveryOutcome,
  details: Record<string, unknown> = {},
) {
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 500
    || !['sent', 'rejected', 'unknown'].includes(outcome)) throw new Error('Invalid delivery completion');
  if (!await readPrivateJson(deliveryPath(eventId, 'claim'))) throw new Error('Delivery event was not claimed');
  const completed = await appendPrivateJson(deliveryPath(eventId, 'result'), {
    ...redact(details) as Record<string, unknown>, event_id: eventId, outcome, completed_at: new Date().toISOString(),
  });
  const result = await readPrivateJson(deliveryPath(eventId, 'result'));
  return { completed, outcome: result?.outcome ?? outcome, message_id: result?.message_id ?? null };
}

export async function getTelegramDelivery(eventId: string) {
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 500) throw new Error('Invalid delivery event ID');
  const [claim, result] = await Promise.all([
    readPrivateJson(deliveryPath(eventId, 'claim')),
    readPrivateJson(deliveryPath(eventId, 'result')),
  ]);
  return { claimed: !!claim, outcome: result?.outcome ?? null, message_id: result?.message_id ?? null };
}
