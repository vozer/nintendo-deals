import { NextRequest, NextResponse } from 'next/server';
import { claimDailyDelivery } from '@/lib/blob-storage';
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
    if (!body || !isValidDate(body.date) || !isValidKey(body.key)) {
      return NextResponse.json({ error: 'Invalid delivery claim' }, { status: 400 });
    }

    return NextResponse.json({ claimed: await claimDailyDelivery(body.date, body.key) });
  } catch (error) {
    console.error('Failed to claim Telegram delivery:', error);
    return NextResponse.json({ error: 'Failed to claim delivery' }, { status: 500 });
  }
}
