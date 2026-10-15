import { Buffer } from 'node:buffer';
import { get as blobGet, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { hasValidApiKey } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function archivePath(date: string, runId: string, attempt: string) {
  return `automation-runs/${date}/${runId}-attempt-${attempt}.tar.gz`;
}

function validRunId(value: string | null): value is string {
  return !!value && /^\d{1,20}$/.test(value);
}

function validAttempt(value: string | null): value is string {
  return !!value && /^\d{1,4}$/.test(value) && Number(value) > 0;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const runId = req.headers.get('x-run-id');
  const attempt = req.headers.get('x-run-attempt');
  const date = req.headers.get('x-run-date');
  if (!validRunId(runId) || !validAttempt(attempt) || !validDate(date)) {
    return NextResponse.json({ error: 'Invalid run identity' }, { status: 400 });
  }
  if (req.headers.get('content-type')?.split(';', 1)[0] !== 'application/gzip') {
    return NextResponse.json({ error: 'Expected a gzip archive' }, { status: 415 });
  }
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: 'Run archive is too large' }, { status: 413 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length === 0 || body.length > MAX_ARCHIVE_BYTES) {
    return NextResponse.json({ error: 'Run archive is empty or too large' }, { status: 413 });
  }
  const pathname = archivePath(date, runId, attempt);
  try {
    await put(pathname, Buffer.from(body), { access: 'private', contentType: 'application/gzip', addRandomSuffix: false,
      allowOverwrite: false, cacheControlMaxAge: 0, token: blobToken() });
    return NextResponse.json({ stored: true, created: true, bytes: body.length }, { status: 201 });
  } catch (error) {
    try {
      const existing = await blobGet(pathname, { access: 'private', token: blobToken(), useCache: false });
      if (existing?.statusCode === 200) {
        return NextResponse.json({ stored: true, created: false }, { status: 200 });
      }
    } catch (readError) {
      console.error('Automation run archive write/read failed:',
        error instanceof Error ? error.name : 'UnknownError',
        readError instanceof Error ? readError.name : 'UnknownError');
    }
    console.error('Automation run archive write failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot store run archive' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = req.nextUrl;
  const runId = searchParams.get('run_id');
  const attempt = searchParams.get('run_attempt');
  const date = searchParams.get('date');
  if (!validRunId(runId) || !validAttempt(attempt) || !validDate(date)) {
    return NextResponse.json({ error: 'Invalid run identity' }, { status: 400 });
  }
  try {
    const archive = await blobGet(archivePath(date, runId, attempt), {
      access: 'private', token: blobToken(), useCache: false,
    });
    if (!archive) return NextResponse.json({ error: 'Run archive not found' }, { status: 404 });
    if (archive.statusCode !== 200) throw new Error('Unexpected archive response');
    return new Response(archive.stream, { headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="nintendo-deals-run-${runId}-attempt-${attempt}.tar.gz"`,
      'Content-Type': 'application/gzip',
    } });
  } catch (error) {
    console.error('Automation run archive read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Cannot read run archive' }, { status: 500 });
  }
}
