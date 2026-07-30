import xss from 'xss';
import { Env } from './index';

// Phase 2: Serverless Backend & Database Optimization
// Stripped off `jsdom` and `nodemailer`, entirely V8 Isolate compatible.
// Column names aligned with schema.sql: post_slug, author_name, author_email, content

export async function handleTwikooRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as any;

    switch (body.event) {
      // ─── Read Comments ──────────────────────────────────────────────────────
      case 'GET_COMMENTS': {
        const { post_slug } = body;
        if (!post_slug) {
          return Response.json(
            { error: 'post_slug is required' },
            { status: 400, headers: corsHeaders }
          );
        }

        // High-performance D1 read (<0.5s response target on V8 Isolate)
        const { results } = await env.DB.prepare(
          `SELECT id, post_slug, author_name, author_email, author_website,
                  content, parent_id, tg_message_id, is_admin, created_at
           FROM comments
           WHERE post_slug = ?
           ORDER BY created_at ASC`
        )
          .bind(post_slug)
          .all();

        return Response.json({ data: results }, { headers: corsHeaders });
      }

      // ─── Submit Comment ──────────────────────────────────────────────────────
      case 'COMMENT': {
        const { post_slug, author_name, author_email, author_website, content, parent_id } = body;

        if (!post_slug || !author_name || !content) {
          return Response.json(
            { error: 'post_slug, author_name, and content are required' },
            { status: 400, headers: corsHeaders }
          );
        }

        // 1. Lightweight HTML Sanitization — replaces heavy jsdom payload
        //    Only allow safe inline formatting tags
        const safeContent = xss(content, {
          whiteList: {
            a: ['href', 'title', 'target', 'rel'],
            p: [],
            br: [],
            strong: [],
            b: [],
            em: [],
            i: [],
            code: [],
            blockquote: [],
          },
          stripIgnoreTag: true,
          onIgnoreTagAttr: (_tag, name, _value) => {
            // Drop all unknown attributes
            if (name.startsWith('on')) return ''; // XSS: drop event handlers
            return undefined;
          },
        });

        // 2. Persist to D1 (V8 Isolate compatible, no external dependencies)
        const id = crypto.randomUUID();
        const createdAt = Math.floor(Date.now() / 1000); // Unix seconds

        await env.DB.prepare(
          `INSERT INTO comments
             (id, post_slug, author_name, author_email, author_website, content, parent_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            post_slug,
            author_name,
            author_email ?? null,
            author_website ?? null,
            safeContent,
            parent_id ?? null,
            createdAt
          )
          .run();

        // 3. Async Webhook mail notification — replaces nodemailer (SMTP-free)
        //    Fires via third-party RESTful mail webhook (e.g. Resend, SendGrid)
        if (env.MAIL_WEBHOOK_URL && author_email) {
          ctx.waitUntil(
            fetch(env.MAIL_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: author_email,
                subject: '您的评论已收到 | Your Comment Was Received',
                html: `<p>您在 <strong>${post_slug}</strong> 的评论已提交，等待博主审阅。</p>`,
                from: 'noreply@zgq.blog',
              }),
            }).catch((err) => console.error('[Mail Webhook] Failed:', err))
          );
        }

        // 4. Notify admin via mail webhook if there is a reply
        if (env.MAIL_WEBHOOK_URL && env.ADMIN_EMAIL && parent_id) {
          ctx.waitUntil(
            fetch(env.MAIL_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: env.ADMIN_EMAIL,
                subject: `[博客] 新回复 on ${post_slug}`,
                html: `<p><strong>${author_name}</strong> 回复了评论：</p><blockquote>${safeContent}</blockquote>`,
                from: 'noreply@zgq.blog',
              }),
            }).catch((err) => console.error('[Admin Notify] Failed:', err))
          );
        }

        return Response.json(
          { success: true, id, message: 'Comment submitted successfully' },
          { headers: corsHeaders }
        );
      }

      default:
        return Response.json(
          { error: `Unknown event: ${body.event}` },
          { status: 400, headers: corsHeaders }
        );
    }
  } catch (error: any) {
    console.error('[Twikoo D1] Error:', error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
