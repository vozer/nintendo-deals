import { BlobPreconditionFailedError, get as blobGet, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { hasValidApiKey, isAuthorizedRequest } from '@/lib/request-auth';
import { OfferEndDate, OfferEndDatesSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
const KEY = 'offer-end-dates.json';
const token = () => process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && Number.isFinite(Date.parse(value));
}

function isRecords(value: unknown): value is Record<string, OfferEndDate> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 20_000 && entries.every(([id, raw]) => {
    if (!/^\d+$/.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const record = raw as Record<string, unknown>;
    return Number.isSafeInteger(record.price_cents) && Number(record.price_cents) >= 0
      && isTimestamp(record.end_datetime);
  });
}

async function readSnapshot() {
  const result = await blobGet(KEY, { access: 'private', token: token(), useCache: false,
    headers: { 'Accept-Encoding': 'identity' } });
  if (!result) return { snapshot: { checked_at: null, records: {} } as OfferEndDatesSnapshot, etag: null as string | null };
  if (result.statusCode !== 200) throw new Error('Unexpected offer end-date snapshot response');
  const value = JSON.parse(await new Response(result.stream).text());
  if (!value || !isTimestamp(value.checked_at) || !isRecords(value.records)) throw new Error('Invalid offer end-date snapshot');
  return { snapshot: { checked_at: value.checked_at, records: value.records } as OfferEndDatesSnapshot,
    etag: result.blob.etag as string | null };
}

export async function GET(req: NextRequest) {
  if (!await isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { snapshot, etag } = await readSnapshot();
    return NextResponse.json({ ...snapshot, etag }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Offer end-date snapshot read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot read offer end dates' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (!isTimestamp(body?.checked_at) || !isRecords(body.records)
      || !(body.etag === null || (typeof body.etag === 'string' && body.etag.length <= 200))) {
      return NextResponse.json({ error: 'Invalid offer end-date snapshot' }, { status: 400 });
    }
    const current = await readSnapshot();
    if (current.etag !== body.etag || (current.snapshot.checked_at && current.snapshot.checked_at > body.checked_at)) {
      return NextResponse.json({ error: 'Snapshot changed; refresh and retry' }, { status: 409 });
    }
    try {
      await put(KEY, JSON.stringify({ checked_at: body.checked_at, records: body.records }), {
        access: 'private', contentType: 'application/json', token: token(), addRandomSuffix: false,
        allowOverwrite: current.etag !== null, cacheControlMaxAge: 0,
        ...(current.etag ? { ifMatch: current.etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error instanceof Error && error.name === 'BlobPreconditionFailedError')) {
        return NextResponse.json({ error: 'Snapshot changed; refresh and retry' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Offer end-date snapshot write failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot update offer end dates' }, { status: 500 });
  }
}
