import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  buildDigestKeyboard,
  isTelegramActorAllowed,
  isTelegramSecretValid,
  parseTelegramCallback,
  telegramRequest,
  updateDigestStatus,
} from '@/lib/telegram';
import { applyPreferencesAction } from '@/lib/preferences-actions';
import { appendTelegramAuditEvent, claimTelegramDelivery, completeTelegramDelivery } from '@/lib/telegram-audit-storage';

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

  let auditCorrelation: string | undefined;
  try {
    const update = await req.json();
    const callback = update?.callback_query;
    auditCorrelation = typeof callback?.id === 'string' ? callback.id
      : update?.update_id != null ? String(update.update_id) : undefined;
    await appendTelegramAuditEvent({
      event_id: `webhook:${randomUUID()}:received`, occurred_at: new Date().toISOString(), direction: 'inbound',
      kind: 'webhook.update.received', correlation_id: auditCorrelation, request: update,
    });
    if (!callback) {
      await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:ignored`, occurred_at: new Date().toISOString(),
        direction: 'internal', kind: 'webhook.update.ignored', correlation_id: auditCorrelation, response: { ignored: true } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
    const message = callback.message;
    const chatId = message?.chat?.id;
    const userId = callback.from?.id;
    if (!isTelegramActorAllowed(chatId, userId)) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Not authorized',
        show_alert: true,
      }, { correlation_id: auditCorrelation });
      await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:rejected`, occurred_at: new Date().toISOString(),
        direction: 'internal', kind: 'webhook.actor.rejected', correlation_id: auditCorrelation,
        response: { reason: 'actor_not_allowed', chat_id: chatId, user_id: userId } });
      return NextResponse.json({ ok: false, error: 'Forbidden' });
    }

    const action = parseTelegramCallback(callback.data);
    if (!action || typeof callback.id !== 'string' || !callback.id) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Unsupported action',
        show_alert: true,
      }, { correlation_id: auditCorrelation });
      await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:rejected`, occurred_at: new Date().toISOString(),
        direction: 'internal', kind: 'webhook.callback.rejected', correlation_id: auditCorrelation,
        response: { reason: 'unsupported_action', callback_data: callback.data } });
      return NextResponse.json({ ok: false, error: 'Invalid callback' });
    }

    const isCaption = typeof message?.caption === 'string';
    const content = isCaption ? message.caption : message?.text;
    const lines = typeof content === 'string' ? content.split('\n') : [];
    const title = (['New deal', 'Price alert', 'Message preview'].includes(lines[0]) ? lines[1] : lines[0])?.trim().slice(0, 200);
    const result = await applyPreferencesAction({ ...action, ...(action.action === 'watch' && title ? { title } : {}) }, callback.id);
    await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:action`, occurred_at: new Date().toISOString(),
      direction: 'internal', kind: 'preference.action.persisted', correlation_id: auditCorrelation,
      response: { action: action.action, fs_id: action.fs_id, changed: result.changed, game: result.game } });
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
    }, { correlation_id: auditCorrelation });

    if (action.action === 'watch') {
      const claim = await claimTelegramDelivery(`alert-reply:${callback.id}`, {
        fs_id: action.fs_id, threshold: action.threshold, callback_id: callback.id,
      });
      if (claim.claimed) {
        try {
          const sent = await telegramRequest(botToken, 'sendMessage', {
          chat_id: chatId,
          text: result.game.watch
            ? `${result.game.watch.title} Alert for <${result.game.watch.threshold}€ set`
            : `${title || 'Game'} Alert is no longer set`,
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: replyMarkup.inline_keyboard
            .map(row => row.filter(button => typeof button?.url === 'string')).filter(row => row.length > 0) },
          }, { correlation_id: auditCorrelation });
          const telegramResult = sent.result && typeof sent.result === 'object' ? sent.result as Record<string, unknown> : {};
          await completeTelegramDelivery(`alert-reply:${callback.id}`, 'sent', {
            message_id: telegramResult.message_id, chat_id: chatId,
          });
        } catch (error) {
          await completeTelegramDelivery(`alert-reply:${callback.id}`, 'unknown', {
            error: error instanceof Error ? error.message : 'UnknownError',
          });
          throw error;
        }
      } else if (claim.outcome !== 'sent') {
        throw new Error('Alert reply was claimed but not confirmed; review Telegram before retrying');
      }
    }

    if (typeof message?.message_id !== 'number' || typeof content !== 'string') {
      await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:completed`, occurred_at: new Date().toISOString(),
        direction: 'internal', kind: 'webhook.action.completed', correlation_id: auditCorrelation,
        response: { changed: result.changed, fs_id: action.fs_id } });
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
    }, { correlation_id: auditCorrelation });

    await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:completed`, occurred_at: new Date().toISOString(),
      direction: 'internal', kind: 'webhook.action.completed', correlation_id: auditCorrelation,
      response: { changed: result.changed, fs_id: action.fs_id } });
    return NextResponse.json({ ok: true, changed: result.changed, game: result.game });
  } catch (error) {
    console.error('Telegram webhook failed:', error instanceof Error ? error.name : 'UnknownError');
    try {
      await appendTelegramAuditEvent({ event_id: `webhook:${randomUUID()}:failed`, occurred_at: new Date().toISOString(),
        direction: 'internal', kind: 'webhook.processing.failed', correlation_id: auditCorrelation,
        response: { error: error instanceof Error ? error.message : 'UnknownError' } });
    } catch {
      console.error('Telegram webhook failure could not be appended to audit log');
    }
    return NextResponse.json({ error: 'Failed to process Telegram callback' }, { status: 500 });
  }
}
