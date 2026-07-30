import { toHTML } from '@telegraf/entity';
import { Env } from './index';

// =============================================================================
// Phase 3: Telegram Bi-directional Sync
// @telegraf/entity handles UTF-16 surrogate-pair offsets correctly.
// Native string .slice() is FORBIDDEN for entity extraction.
// =============================================================================

// ─── Telegram → Blog: Webhook Receiver ──────────────────────────────────────
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update = (await request.json()) as any;
    const message = update.message || update.channel_post;

    if (!message) {
      return new Response('OK', { status: 200 });
    }

    // Only process text messages with entities
    if (message.text) {
      const text: string = message.text;
      const entities = message.entities ?? [];

      // 1. UTF-16 compliant entity → HTML conversion
      //    @telegraf/entity internally uses Buffer.from(text, 'utf16le').length
      //    to compute code-unit offsets, correctly handling emoji surrogate pairs.
      //    Do NOT use text.slice(entity.offset, entity.offset + entity.length).
      const parsedHtml = toHTML({ text, entities });

      // 2. Reverse-lookup: map Telegram message → blog post_slug
      //    If this message is a reply to a channel post, find the originating article.
      let postSlug = 'telegram-general-discussion';

      if (message.reply_to_message?.message_id) {
        const tgMsgId: number = message.reply_to_message.message_id;

        // Look up which post was originally broadcast with this Telegram message ID
        const row = await env.DB.prepare(
          'SELECT post_slug FROM posts WHERE tg_channel_message_id = ? LIMIT 1'
        )
          .bind(tgMsgId)
          .first();

        if (row?.post_slug) {
          postSlug = row.post_slug as string;
        }
      }

      // 3. Write Telegram comment straight to D1
      const nick = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ')
        || message.from?.username
        || 'Telegram User';

      const commentId = crypto.randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO comments
           (id, post_slug, author_name, content, tg_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(commentId, postSlug, nick, parsedHtml, message.message_id, createdAt)
        .run();
    }

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('[Telegram Webhook] Error:', err);
    // Always return 200 to prevent Telegram from retrying
    return new Response('OK', { status: 200 });
  }
}

// ─── Blog → Telegram: Rich Message Broadcast ─────────────────────────────────
// Employs Telegram Bot API 10.2 InputRichMessage AST Blocks.
// Block `type` fields MUST be the API string literals, not class names.
// Reference: https://core.telegram.org/bots/api#inputrichmessage
export async function broadcastToTelegram(
  env: Env,
  opts: {
    postTitle: string;
    postSummary: string;
    postUrl: string;
    postSlug: string;
    tags?: string[];
  }
): Promise<number | null> {
  const apiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendRichMessage`;

  // Construct tags chip line
  const tagLine = opts.tags && opts.tags.length > 0
    ? opts.tags.map((t) => `#${t.replace(/\s+/g, '_')}`).join('  ')
    : '';

  // ── AST Block Construction ──────────────────────────────────────────────────
  // Per Bot API 10.2: InputRichMessage.blocks is Array<InputRichBlock>
  // Each block must have `type` as one of the enumerated API string values.
  // Text nodes use inline RichText objects: { text: string } for plain text,
  // or wrapped in formatting: e.g. { type: "bold", text: "..." }
  const blocks: any[] = [
    // H1: Post title as section heading
    {
      type: 'heading',
      text: { text: `🚀 ${opts.postTitle}` },
      size: 1,
    },
    // Paragraph: Summary text
    {
      type: 'paragraph',
      text: { text: opts.postSummary },
    },
    // Horizontal divider
    {
      type: 'divider',
    },
    // Paragraph: Tags + read more link
    {
      type: 'paragraph',
      text: {
        type: 'concat',
        texts: [
          ...(tagLine ? [{ text: tagLine + '\n' }] : []),
          {
            type: 'url',
            text: '📖 阅读全文',
            url: opts.postUrl,
          },
        ],
      },
    },
    // Footer: Author attribution
    {
      type: 'footer',
      text: { text: 'ZGQ Inc. · Serverless Blog' },
    },
  ];

  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    rich_message: { blocks },
  };

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram Broadcast] API Error:', err);
      return null;
    }

    const data = (await res.json()) as any;
    const messageId: number = data?.result?.message_id ?? null;

    // Persist the Telegram message ID back into the posts table
    // so the webhook reverse-lookup can find this article later
    if (messageId && opts.postSlug) {
      await env.DB.prepare(
        `UPDATE posts SET tg_channel_message_id = ?, updated_at = ?
         WHERE post_slug = ?`
      )
        .bind(messageId, Math.floor(Date.now() / 1000), opts.postSlug)
        .run();
    }

    return messageId;
  } catch (err: any) {
    console.error('[Telegram Broadcast] Fetch Error:', err);
    return null;
  }
}
