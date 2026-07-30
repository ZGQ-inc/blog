import xss from 'xss';
import { Env } from './index';

// Phase 2: Serverless Backend & Database Optimization
// Stripped off `jsdom` and `nodemailer`, entirely V8 Isolate compatible.
export async function handleTwikooRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as any;
    
    switch (body.event) {
      case 'GET_COMMENTS': {
        // High performance D1 read (< 0.5s response)
        const { results } = await env.DB.prepare(
          'SELECT * FROM comments WHERE url = ? ORDER BY created_at DESC'
        ).bind(body.url).all();
        return Response.json({ data: results });
      }

      case 'COMMENT': {
        // 1. Lightweight HTML Sanitization replacing heavy jsdom payload
        const safeComment = xss(body.comment, {
          whiteList: { a: ['href', 'title', 'target'], p: [], br: [], strong: [], em: [] },
          stripIgnoreTag: true
        });

        // 2. Persist to D1
        const insertStmt = env.DB.prepare(
          'INSERT INTO comments (url, nick, mail, comment, created_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(body.url, body.nick, body.mail, safeComment, Date.now());
        await insertStmt.run();

        // 3. Asynchronous Webhook Mail Notification (replacing nodemailer)
        if (env.MAIL_WEBHOOK_URL && body.mail) {
          ctx.waitUntil(
            fetch(env.MAIL_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                to: body.mail, 
                subject: 'New Reply Received', 
                text: 'Someone replied to your comment on the blog.' 
              })
            }).catch(err => console.error('Webhook mail failed:', err))
          );
        }

        return Response.json({ success: true, message: 'Comment submitted successfully' });
      }
        
      default:
        return new Response('Not Implemented', { status: 400 });
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
