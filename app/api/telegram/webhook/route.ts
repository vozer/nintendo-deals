import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import {
  buildDigestKeyboard,
  isTelegramActorAllowed,
  isTelegramSecretValid,
  parseTelegramCallback,
  telegramRequest,
  updateDigestStatus,
} from '@/lib/telegram';
import { applyPreferencesAction } from '@/lib/preferences-actions';
import { hasProcessedTelegramUpdate, updatePreferencesAtomically } from '@/lib/blob-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  if (!isTelegramSecretValid(
    req.headers.get('x-telegram-bot-api-secret-token'),
    process.env.TELEGRAM_WEBHOOK_SECRET,
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await req.json();
    const callback = update?.callback_query;
    if (!callback) return NextResponse.json({ ok: true, ignored: true });

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
    const message = callback.message;
    const chatId = message?.chat?.id;
    const userId = callback.from?.id;
    if (!isTelegramActorAllowed(chatId, userId)) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Not authorized',
        show_alert: true,
      });
      return NextResponse.json({ ok: false, error: 'Forbidden' });
    }

    const action = parseTelegramCallback(callback.data);
    if (!action || typeof callback.id !== 'string' || !callback.id) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Unsupported action',
        show_alert: true,
      });
      return NextResponse.json({ ok: false, error: 'Invalid callback' });
    }

    const isCaption = typeof message?.caption === 'string';
    const content = isCaption ? message.caption : message?.text;
    const lines = typeof content === 'string' ? content.split('\n') : [];
    const title = (['New deal', 'Price alert', 'Message preview'].includes(lines[0]) ? lines[1] : lines[0])?.trim().slice(0, 200);
    const result = await applyPreferencesAction({ ...action, ...(action.action === 'watch' && title ? { title } : {}) }, callback.id);
    const baseUrl = process.env.NINTENDO_DEALS_BASE_URL || new URL(req.url).origin;
    const fallbackKeyboard = buildDigestKeyboard(action.fs_id, baseUrl);
    const originalKeyboard = message?.reply_markup?.inline_keyboard;
    const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> =
      Array.isArray(originalKeyboard) && originalKeyboard.every(Array.isArray)
        ? originalKeyboard : fallbackKeyboard.inline_keyboard;
    const replyMarkup = { inline_keyboard: keyboard.some(row => row.some(button => button?.text === 'Show'))
      ? keyboard : [[fallbackKeyboard.inline_keyboard[0][0]], ...keyboard] };

    await telegramRequest(botToken, 'answerCallbackQuery', {
      callback_query_id: callback.id,
      ...(action.action === 'hide' ? { text: result.changed ? 'Game hidden' : 'Game is already hidden' } : {}),
    });

    if (action.action === 'watch') {
      const replyId = createHash('sha256').update(callback.id).digest('hex');
      const claimId = `alert-reply:${replyId}`;
      const sentId = `alert-reply-sent:${replyId}`;
      const claim = await updatePreferencesAtomically(current => current, claimId);
      if (!claim.duplicate) {
        await telegramRequest(botToken, 'sendMessage', {
          chat_id: chatId,
          text: result.game.watch
            ? `${result.game.watch.title} Alert for <${result.game.watch.threshold}€ set`
            : `${title || 'Game'} Alert is no longer set`,
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: replyMarkup.inline_keyboard
            .map(row => row.filter(button => typeof button?.url === 'string')).filter(row => row.length > 0) },
        });
        await updatePreferencesAtomically(current => current, sentId);
      } else if (!await hasProcessedTelegramUpdate(sentId)) {
        throw new Error('Alert reply was claimed but not confirmed; review Telegram before retrying');
      }
    }

    if (typeof message?.message_id !== 'number' || typeof content !== 'string') {
      return NextResponse.json({ ok: true, changed: result.changed });
    }

    // Telegram returns plain text, not the original HTML. Escape it before editing.
    const text = updateDigestStatus(content, result.game)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    await telegramRequest(botToken, isCaption ? 'editMessageCaption' : 'editMessageText', {
      chat_id: chatId,
      message_id: message.message_id,
      ...(isCaption ? { caption: text } : { text, disable_web_page_preview: true }),
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });

    return NextResponse.json({ ok: true, changed: result.changed, game: result.game });
  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return NextResponse.json({ error: 'Failed to process Telegram callback' }, { status: 500 });
  }
}
