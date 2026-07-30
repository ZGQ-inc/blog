import { toHTML } from '@telegraf/entity';
import { Env } from './index';

// Phase 3: Telegram Bi-directional Sync
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const update = await request.json() as any;
  
  if (update.message && update.message.text) {
    // 1. Markdown Reverse Logic: Critical 防雷
    // Using @telegraf/entity to compute offsets precisely on UTF-16 surrogate pairs.
    // Explicitly forbidding native string `.slice()` which breaks on emojis.
    const text = update.message.text;
    const entities = update.message.entities || [];
    
    const parsedHtml = toHTML({ text, entities });
    
    // 2. Write straight to Cloudflare D1
    // (In production, map `reply_to_message.message_id` to the actual blog URL)
    const targetBlogUrl = '/telegram-sync-target'; 
    const nick = update.message.from.first_name || 'Telegram User';

    const insertStmt = env.DB.prepare(
      'INSERT INTO comments (url, nick, comment, created_at) VALUES (?, ?, ?, ?)'
    ).bind(targetBlogUrl, nick, parsedHtml, Date.now());
    
    await insertStmt.run();
  }
  
  return new Response('OK', { status: 200 });
}

// Phase 3: Blog -> Telegram Broadcast
// Employs Telegram Bot API 10.2 InputRichMessage AST Blocks 
export async function broadcastToTelegram(env: Env, postTitle: string, postSummary: string) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendRichMessage`;
  
  // AST construction discarding old HTML/MarkdownV2 string concatenation
  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    rich_message: {
      blocks: [
        {
          type: "InputRichBlockSectionHeading",
          text: { type: "RichTextBold", text: `🚀 New Post: ${postTitle}` }
        },
        {
          type: "InputRichBlockParagraph",
          text: { type: "RichTextPlain", text: postSummary }
        },
        {
          type: "InputRichBlockDivider"
        }
      ]
    }
  };
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
