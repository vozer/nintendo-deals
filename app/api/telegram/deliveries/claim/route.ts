import { NextRequest, NextResponse } from 'next/server';
import { claimDailyDelivery, hasDailyDelivery } from '@/lib/blob-storage';
import { claimTelegramDelivery, completeTelegramDelivery, getTelegramDelivery } from '@/lib/telegram-audit-storage';
import { hasValidApiKey } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9:_-]{1,120}$/i.test(value);
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (body && typeof body.event_id === 'string') {
      if (body.operation === 'complete') {
        if (!['sent', 'rejected', 'unknown'].includes(body.outcome)
          || !body.details || typeof body.details !== 'object' || Array.isArray(body.details)) {
          return NextResponse.json({ error: 'Invalid delivery completion' }, { status: 400 });
        }
        return NextResponse.json(await completeTelegramDelivery(body.event_id, body.outcome, body.details));
      }
      if (body.operation !== undefined && body.operation !== 'claim') {
        return NextResponse.json({ error: 'Invalid delivery operation' }, { status: 400 });
      }
      if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
        return NextResponse.json({ error: 'Invalid delivery metadata' }, { status: 400 });
      }
      return NextResponse.json(await claimTelegramDelivery(body.event_id, body.metadata ?? {}));
    }
    if (!body || !isValidDate(body.date) || !isValidKey(body.key)) {
      return NextResponse.json({ error: 'Invalid delivery claim' }, { status: 400 });
    }

    return NextResponse.json({ claimed: await claimDailyDelivery(body.date, body.key) });
  } catch (error) {
    console.error('Failed to claim Telegram delivery:', error);
    return NextResponse.json({ error: 'Failed to claim delivery' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (eventId) {
    try {
      return NextResponse.json(await getTelegramDelivery(eventId));
    } catch {
      return NextResponse.json({ error: 'Cannot read delivery status' }, { status: 500 });
    }
  }
  const date = req.nextUrl.searchParams.get('date');
  const key = req.nextUrl.searchParams.get('key');
  if (!isValidDate(date) || !isValidKey(key)) return NextResponse.json({ error: 'Invalid delivery lookup' }, { status: 400 });
  try {
    return NextResponse.json({ claimed: await hasDailyDelivery(date, key) });
  } catch {
    return NextResponse.json({ error: 'Cannot read delivery status' }, { status: 500 });
  }
}
