import { NextRequest, NextResponse } from 'next/server';
import { getPreferencesStrict, savePreferences } from '@/lib/blob-storage';
import { isAuthorizedRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

type PreferencesActionPayload = {
  action: 'hide' | 'unhide' | 'watch' | 'unwatch' | 'think' | 'unthink' | 'toggle_thinking';
  fs_id: string;
  title?: string;
  threshold?: 2 | 5 | 10;
};

const THRESHOLDS = new Set([2, 5, 10]);
const ACTIONS = new Set([
  'hide',
  'unhide',
  'watch',
  'unwatch',
  'think',
  'unthink',
  'toggle_thinking',
]);
const GAME_ID_PATTERN = /^\d+$/;

async function fetchTitleFromNintendo(fsId: string): Promise<string | null> {
  const params = new URLSearchParams({
    q: '*',
    fq: `type:GAME AND system_type:nintendoswitch* AND fs_id:${fsId}`,
    rows: '1',
    wt: 'json',
    fl: 'title,title_master_s',
  });

  try {
    const res = await fetch(`https://searching.nintendo-europe.com/es/select?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const data = await res.json();
    const doc = data?.response?.docs?.[0];
    if (!doc) return null;

    return doc.title_master_s || doc.title || null;
  } catch {
    return null;
  }
}

function parsePayload(body: unknown): PreferencesActionPayload | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Partial<PreferencesActionPayload>;

  if (typeof payload.action !== 'string' || !ACTIONS.has(payload.action)) return null;
  if (!payload.fs_id || typeof payload.fs_id !== 'string') return null;
  const fsId = payload.fs_id.trim();
  if (!GAME_ID_PATTERN.test(fsId)) return null;

  if (payload.action === 'watch') {
    if (typeof payload.threshold !== 'number' || !THRESHOLDS.has(payload.threshold)) return null;
  }

  return {
    action: payload.action as PreferencesActionPayload['action'],
    fs_id: fsId,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    threshold: payload.threshold,
  };
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = parsePayload(await req.json());
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid action payload' }, { status: 400 });
    }

    const current = await getPreferencesStrict();
    const next = {
      hiddenGames: Array.isArray(current.hiddenGames) ? [...current.hiddenGames] : [],
      watchGames: { ...(current.watchGames || {}) },
      thinkingAbout: Array.isArray(current.thinkingAbout) ? [...current.thinkingAbout] : [],
    };

    let changed = false;

    switch (parsed.action) {
      case 'hide': {
        if (!next.hiddenGames.includes(parsed.fs_id)) {
          next.hiddenGames.push(parsed.fs_id);
          changed = true;
        }
        break;
      }
      case 'unhide': {
        const before = next.hiddenGames.length;
        next.hiddenGames = next.hiddenGames.filter((id) => id !== parsed.fs_id);
        changed = next.hiddenGames.length !== before;
        break;
      }
      case 'watch': {
        const threshold = parsed.threshold as 2 | 5 | 10;
        const existing = next.watchGames[parsed.fs_id];
        let title = parsed.title?.trim() || existing?.title || '';

        if (!title) {
          title = (await fetchTitleFromNintendo(parsed.fs_id)) || parsed.fs_id;
        }

        if (!existing || existing.threshold !== threshold || existing.title !== title) {
          next.watchGames[parsed.fs_id] = { threshold, title };
          changed = true;
        }
        break;
      }
      case 'unwatch': {
        if (next.watchGames[parsed.fs_id]) {
          delete next.watchGames[parsed.fs_id];
          changed = true;
        }
        break;
      }
      case 'think': {
        if (!next.thinkingAbout.includes(parsed.fs_id)) {
          next.thinkingAbout.push(parsed.fs_id);
          changed = true;
        }
        break;
      }
      case 'unthink': {
        const before = next.thinkingAbout.length;
        next.thinkingAbout = next.thinkingAbout.filter((id) => id !== parsed.fs_id);
        changed = next.thinkingAbout.length !== before;
        break;
      }
      case 'toggle_thinking': {
        if (next.thinkingAbout.includes(parsed.fs_id)) {
          next.thinkingAbout = next.thinkingAbout.filter((id) => id !== parsed.fs_id);
        } else {
          next.thinkingAbout.push(parsed.fs_id);
        }
        changed = true;
        break;
      }
    }

    if (changed) {
      await savePreferences(next);
    }

    const watch = next.watchGames[parsed.fs_id] || null;

    return NextResponse.json({
      ok: true,
      changed,
      game: {
        fs_id: parsed.fs_id,
        hidden: next.hiddenGames.includes(parsed.fs_id),
        watch,
        thinking: next.thinkingAbout.includes(parsed.fs_id),
      },
    });
  } catch (error) {
    console.error('Failed to apply preferences action:', error);
    return NextResponse.json({ error: 'Failed to apply action' }, { status: 500 });
  }
}
