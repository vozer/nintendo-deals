import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  raw: null as string | null,
  revision: 0,
  writes: 0,
  events: [] as string[],
  failWrites: false,
  failEdits: 0,
  failReplies: 0,
}));

vi.mock('@vercel/blob', () => ({
  get: async () => {
    if (state.raw === null) return null;
    return {
      statusCode: 200,
      stream: new Response(state.raw).body,
      blob: { etag: String(state.revision) },
    };
  },
  put: async (_pathname: string, body: string, options: Record<string, unknown>) => {
    if (state.failWrites) throw new Error('synthetic blob write failure');
    if (options.ifMatch && options.ifMatch !== String(state.revision)) {
      const error = new Error('precondition failed');
      error.name = 'BlobPreconditionFailedError';
      throw error;
    }
    if (!options.ifMatch && state.raw !== null && options.allowOverwrite !== true) {
      throw new Error('blob already exists');
    }
    state.raw = body;
    state.revision += 1;
    state.writes += 1;
    state.events.push('persist');
  },
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
}));

import { POST } from './route';

function callbackRequest(options: { secret?: string; chatId?: number; userId?: number; photo?: boolean; watch?: boolean; callbackId?: string } = {}) {
  return new NextRequest('https://nintendo-deals.test/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': options.secret ?? 'test-webhook-secret',
    },
    body: JSON.stringify({
      callback_query: {
        id: options.callbackId ?? 'callback-unique-1',
        data: options.watch ? 'nd:watch:5:1001' : 'nd:hide:1001',
        from: { id: options.userId ?? 77 },
        message: {
          message_id: 9,
          ...(options.watch ? { caption: 'New deal\nFuture Knight\n11.99 EUR\nStatus: Hidden No; Alert: none' } : options.photo ? { caption: 'Adventure & puzzles\nStatus: Hidden No; Alert: none', reply_markup: { inline_keyboard: [[{ text: 'Nintendo', url: 'https://www.nintendo.com/game' }]] } } : { text: '<b>Example game</b>' }),
          chat: { id: options.chatId ?? 88 },
        },
      },
    }),
  });
}

beforeEach(() => {
  state.raw = null;
  state.revision = 0;
  state.writes = 0;
  state.events = [];
  state.failWrites = false;
  state.failEdits = 0;
  state.failReplies = 0;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.NINTENDO_TELEGRAM_CHAT_ID = '88';
  process.env.NINTENDO_TELEGRAM_USER_ID = '77';
  process.env.NINTENDO_DEALS_BASE_URL = 'https://nintendo-deals.test';
});

afterEach(() => vi.restoreAllMocks());

describe('Telegram callback webhook', () => {
  it('does not claim a removed alert is set when replaying an old persisted action', async () => {
    state.raw = JSON.stringify({ version: 1,
      preferences: { hiddenGames: [], watchGames: {}, thinkingAbout: [] },
      telegram: { processedUpdateIds: ['callback-unique-1'] } });
    const telegram = stubTelegram();
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(200);
    const reply = telegram.mock.calls.find(([url]) => String(url).endsWith('/sendMessage'));
    expect(JSON.parse(String(reply?.[1]?.body)).text).toBe('Future Knight Alert is no longer set');
    expect(JSON.parse(state.raw!).preferences.watchGames).toEqual({});
  });
  it('confirms a new deliberate alert click even when that threshold is already configured', async () => {
    const telegram = stubTelegram();
    await POST(callbackRequest({ watch: true }));
    const response = await POST(callbackRequest({ watch: true, callbackId: 'callback-unique-2' }));
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
    expect(telegram.mock.calls.filter(([url]) => String(url).endsWith('/sendMessage'))).toHaveLength(2);
  });
  it('confirms alerts with one persistent titled message and a direct game link, not a toast', async () => {
    state.raw = JSON.stringify({ hiddenGames: ['2002'], thinkingAbout: ['2003'],
      watchGames: { '2004': { threshold: 2, title: 'Existing watch' } } });
    const telegram = stubTelegram();
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(200);
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(200);
    const calls = telegram.mock.calls.filter(([url]) => String(url).startsWith('https://api.telegram.org/'))
      .map(([url, request]) => ({ url: String(url), body: JSON.parse(String(request?.body)) }));
    const replies = calls.filter(call => call.url.endsWith('/sendMessage'));
    expect(replies).toHaveLength(1);
    expect(replies[0].body.text).toBe('Future Knight Alert for <5€ set');
    expect(replies[0].body.reply_markup.inline_keyboard[0][0].url).toBe('https://nintendo-deals.test/?game=1001');
    for (const ack of calls.filter(call => call.url.endsWith('/answerCallbackQuery'))) expect(ack.body.text).toBeUndefined();
    expect(state.events[0]).toBe('persist');
    expect(JSON.parse(state.raw!).preferences.watchGames['1001']).toEqual({ threshold: 5, title: 'Future Knight' });
    expect(JSON.parse(state.raw!).preferences.watchGames['2004']).toEqual({ threshold: 2, title: 'Existing watch' });
    expect(JSON.parse(state.raw!).preferences.hiddenGames).toEqual(['2002']);
    expect(JSON.parse(state.raw!).preferences.thinkingAbout).toEqual(['2003']);
  });
  it('edits photo captions and preserves source buttons after persisting', async () => {
    const telegram = stubTelegram();
    const response = await POST(callbackRequest({ photo: true }));
    expect(response.status).toBe(200);
    const [url, request] = telegram.mock.calls[1];
    expect(String(url)).toContain('/editMessageCaption');
    const payload = JSON.parse(String(request?.body));
    expect(payload.caption).toContain('Status: Hidden Yes; Alert: none');
    expect(payload.caption).toContain('Adventure &amp; puzzles');
    expect(payload.reply_markup.inline_keyboard[0][0].text).toBe('Nintendo');
    expect(state.events[0]).toBe('persist');
  });
  function stubTelegram() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const isAck = url.includes('/answerCallbackQuery');
      const isReply = url.includes('/sendMessage');
      state.events.push(isAck ? 'ack' : isReply ? 'reply' : 'edit');
      if (isReply && state.failReplies > 0) {
        state.failReplies -= 1;
        return Response.json({ ok: false }, { status: 500 });
      }
      if (!isAck && !isReply && state.failEdits > 0) {
        state.failEdits -= 1;
        return Response.json({ ok: false, description: 'synthetic edit failure' }, { status: 500 });
      }
      return Response.json({ ok: true, result: {} });
    });
  }

  it('rejects an invalid webhook secret and an unexpected chat/user', async () => {
    const telegram = stubTelegram();
    const invalidSecret = await POST(callbackRequest({ secret: 'wrong-secret' }));
    const unexpectedActor = await POST(callbackRequest({ chatId: 99, userId: 100 }));

    expect(invalidSecret.status).toBe(401);
    expect(unexpectedActor.status).toBe(200);
    expect(await unexpectedActor.json()).toEqual({ ok: false, error: 'Forbidden' });
    expect(state.writes).toBe(0);
    expect(telegram).toHaveBeenCalledTimes(1);
  });

  it('persists before acknowledgment and applies duplicate callback updates once', async () => {
    stubTelegram();

    const first = await POST(callbackRequest());
    const replay = await POST(callbackRequest());

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(state.events.indexOf('persist')).toBeLessThan(state.events.indexOf('ack'));
    expect(state.writes).toBe(1);
    const document = JSON.parse(state.raw!);
    expect(document.preferences.hiddenGames).toEqual(['1001']);
    expect(document.telegram.processedUpdateIds).toEqual(['callback-unique-1']);
  });

  it('does not acknowledge when preference persistence fails', async () => {
    state.failWrites = true;
    const telegram = stubTelegram();

    const response = await POST(callbackRequest());
    const watchResponse = await POST(callbackRequest({ watch: true }));

    expect(response.status).toBe(500);
    expect(watchResponse.status).toBe(500);
    expect(telegram).not.toHaveBeenCalled();
  });

  it('does not duplicate a persistent alert confirmation while repairing a failed caption edit', async () => {
    const telegram = stubTelegram();
    state.failEdits = 1;
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(500);
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(200);
    expect(telegram.mock.calls.filter(([url]) => String(url).endsWith('/sendMessage'))).toHaveLength(1);
    expect(JSON.parse(state.raw!).preferences.watchGames['1001'].threshold).toBe(5);
  });

  it('fails visibly for an unconfirmed reply without blindly sending another message', async () => {
    const telegram = stubTelegram();
    state.failReplies = 1;
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(500);
    expect((await POST(callbackRequest({ watch: true }))).status).toBe(500);
    expect(telegram.mock.calls.filter(([url]) => String(url).endsWith('/sendMessage'))).toHaveLength(1);
    expect(JSON.parse(state.raw!).preferences.watchGames['1001'].threshold).toBe(5);
  });

  it('retries a failed Telegram edit without applying the preference twice', async () => {
    stubTelegram();
    state.failEdits = 1;

    const failedEdit = await POST(callbackRequest());
    const replay = await POST(callbackRequest());

    expect(failedEdit.status).toBe(500);
    expect(replay.status).toBe(200);
    expect(state.writes).toBe(1);
    expect(JSON.parse(state.raw!).preferences.hiddenGames).toEqual(['1001']);
  });
});
