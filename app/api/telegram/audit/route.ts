import { NextRequest, NextResponse } from 'next/server';
import { appendTelegramAuditEvent, listTelegramAuditEvents, TelegramAuditEvent } from '@/lib/telegram-audit-storage';
import { hasValidApiKey } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const length = Number(req.headers.get('content-length') || 0);
  if (length > 300_000) return NextResponse.json({ error: 'Audit record is too large' }, { status: 413 });
  try {
    const event = await req.json() as TelegramAuditEvent;
    const result = await appendTelegramAuditEvent(event);
    return NextResponse.json({ stored: true, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error('Telegram audit append failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot store Telegram audit record' }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = req.nextUrl.searchParams.get('date') || utcToday();
  const rawLimit = req.nextUrl.searchParams.get('limit') || '50';
  const limit = Number(rawLimit);
  const cursor = req.nextUrl.searchParams.get('cursor') || undefined;
  const direction = req.nextUrl.searchParams.get('direction') || undefined;
  const kind = req.nextUrl.searchParams.get('kind') || undefined;
  const correlationId = req.nextUrl.searchParams.get('correlation_id') || undefined;
  const query = req.nextUrl.searchParams.get('q')?.trim() || undefined;
  if (!isDate(date) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (cursor !== undefined && (cursor.length > 3000 || !/^[\x21-\x7E]+$/.test(cursor)))
    || (direction !== undefined && !['inbound', 'outbound', 'internal'].includes(direction))
    || (kind !== undefined && !/^[a-z0-9._-]{1,80}$/i.test(kind))
    || (correlationId !== undefined && correlationId.length > 200)
    || (query !== undefined && query.length > 100)) {
    return NextResponse.json({ error: 'Invalid audit query' }, { status: 400 });
  }
  try {
    const page = await listTelegramAuditEvents(date, cursor, limit, {
      direction: direction as 'inbound' | 'outbound' | 'internal' | undefined,
      kind,
      correlation_id: correlationId,
      q: query,
    });
    return NextResponse.json({ date, filters: { direction, kind, correlation_id: correlationId, q: query }, ...page },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Telegram audit read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot read Telegram audit records' }, { status: 500 });
  }
}
