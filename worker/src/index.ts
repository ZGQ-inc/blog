import { handleTwikooRequest } from './twikoo-d1';
import { handleTelegramWebhook } from './telegram-sync';
import { handleGitOpsPublish, handleGitOpsGetSha } from './gitops';

// =============================================================================
// Cloudflare Worker — Serverless Blog & Forum Backend
// Author: ZGQ Inc. | Runtime: V8 Isolate (< 1 MiB)
// =============================================================================

export interface Env {
  // Cloudflare D1 database binding
  DB: D1Database;

  // Telegram Bot API credentials
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;

  // Email webhook (Resend / SendGrid / etc. RESTful API — no SMTP)
  MAIL_WEBHOOK_URL: string;
  ADMIN_EMAIL: string;

  // GitHub REST API for GitOps publishing
  GITHUB_PAT: string;
  GITHUB_OWNER: string;    // e.g. "zgq-inc"
  GITHUB_REPO: string;     // e.g. "blog"

  // Optional: Cloudflare R2 for media uploads
  MEDIA_BUCKET?: R2Bucket;

  // Secret token to verify Telegram webhook requests
  TELEGRAM_SECRET_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // ─── CORS Preflight ────────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ─── Phase 2: Twikoo Comment API (Cloudflare D1) ──────────────────────────
    if (pathname === '/api/twikoo' && method === 'POST') {
      return await handleTwikooRequest(request, env, ctx);
    }

    // ─── Phase 3: Telegram → Blog Sync Webhook ────────────────────────────────
    if (pathname === '/api/telegram/webhook' && method === 'POST') {
      // Validate secret token header if configured
      if (env.TELEGRAM_SECRET_TOKEN) {
        const receivedToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (receivedToken !== env.TELEGRAM_SECRET_TOKEN) {
          return new Response('Unauthorized', { status: 401 });
        }
      }
      return await handleTelegramWebhook(request, env);
    }

    // ─── Phase 4: GitHub GitOps — Fetch SHA (乐观锁前置) ─────────────────────
    if (pathname === '/api/admin/sha' && method === 'GET') {
      // Require admin auth via Bearer token (== GITHUB_PAT as proxy)
      const auth = request.headers.get('Authorization');
      if (!auth || auth !== `Bearer ${env.GITHUB_PAT}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      return await handleGitOpsGetSha(request, env);
    }

    // ─── Phase 4: GitHub GitOps — Publish / Update ────────────────────────────
    if (pathname === '/api/admin/publish' && method === 'PUT') {
      // Require admin auth via Bearer token
      const auth = request.headers.get('Authorization');
      if (!auth || auth !== `Bearer ${env.GITHUB_PAT}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      return await handleGitOpsPublish(request, env);
    }

    // ─── Health Check ─────────────────────────────────────────────────────────
    if (pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        version: '1.0.0',
        author: 'ZGQ Inc.',
        timestamp: new Date().toISOString(),
      });
    }

    return new Response('Serverless Blog Backend — ZGQ Inc.', { status: 200 });
  },
};
