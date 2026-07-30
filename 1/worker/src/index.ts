import { handleTwikooRequest } from './twikoo-d1';
import { handleTelegramWebhook } from './telegram-sync';
import { handleGitOpsPublish } from './gitops';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  MAIL_WEBHOOK_URL: string;
  GITHUB_PAT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Phase 2: Refactored Twikoo API (Cloudflare D1)
    if (url.pathname === '/api/twikoo' && request.method === 'POST') {
      return await handleTwikooRequest(request, env, ctx);
    }

    // Phase 3: Telegram -> Blog Sync Webhook
    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      return await handleTelegramWebhook(request, env);
    }

    // Phase 4: GitHub REST API GitOps (Publish/Edit)
    if (url.pathname === '/api/admin/publish' && request.method === 'PUT') {
      return await handleGitOpsPublish(request, env);
    }

    return new Response('Serverless Blog Backend Active', { status: 200 });
  },
};
