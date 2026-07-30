import { Env } from '../index';
// 强制依赖轻量级 xss 模块代替庞大的 jsdom，完美契合 Cloudflare V8 Isolate 体积与性能约束
import xss from 'xss';

export interface CommentPayload {
  post_slug: string;
  author_name: string;
  author_email?: string;
  author_website?: string;
  content: string;
  parent_id?: string;
}

/**
 * [Milestone 6: 极速版 Twikoo] - 读取文章评论树
 */
export async function getComments(env: Env, postSlug: string): Promise<Response> {
  try {
    // 利用 D1 边缘 SQLite 的高性能，直接吐出展平的评论数据，前端渲染时自行组装树状结构
    const stmt = env.DB.prepare(`
      SELECT * FROM comments 
      WHERE post_slug = ? 
      ORDER BY created_at ASC
    `).bind(postSlug);
    
    const { results } = await stmt.all();

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('D1 Read Error:', error);
    return new Response(JSON.stringify({ error: 'Database Error' }), { status: 500 });
  }
}

/**
 * [Milestone 6: 极速版 Twikoo] - 发布新评论
 */
export async function postComment(env: Env, payload: CommentPayload, ctx: ExecutionContext): Promise<Response> {
  try {
    // 1. 深度 XSS 消毒。剥离 script 和危险标签，彻底摒弃服务端 jsdom DOM 树解析
    const safeContent = xss(payload.content, {
      whiteList: {
        a: ['href', 'title', 'target', 'rel'],
        b: [], i: [], strong: [], em: [], p: [], br: [], code: [], pre: [],
        img: ['src', 'alt'] // 允许部分基础富文本
      },
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script', 'style', 'iframe']
    });

    // 2. 生成基础元数据
    const commentId = crypto.randomUUID(); // Web Crypto API
    const createdAt = Math.floor(Date.now() / 1000);

    // 3. 高速写入 Cloudflare D1
    const stmt = env.DB.prepare(`
      INSERT INTO comments (id, post_slug, author_name, author_email, author_website, content, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      commentId,
      payload.post_slug,
      payload.author_name,
      payload.author_email || null,
      payload.author_website || null,
      safeContent,
      payload.parent_id || null,
      createdAt
    );

    await stmt.run();

    // 4. 后台静默触发邮件通知，绝不阻塞主线程
    // 废弃 Nodemailer + SMTP 体系，利用 ctx.waitUntil 发起外部 Webhook
    if (env.WEBHOOK_URL) {
      ctx.waitUntil(triggerEmailWebhook(env, payload, safeContent));
    }

    // 控制整体链路 < 0.5s
    return new Response(JSON.stringify({ success: true, id: commentId, content: safeContent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('D1 Write Error:', error);
    return new Response(JSON.stringify({ error: 'Database Error' }), { status: 500 });
  }
}

/**
 * 外部邮件触发器 (RESTful Webhook)
 * 可接入 SendGrid, Resend 或自建通知网关，免去底层 SMTP 协议解析开销
 */
async function triggerEmailWebhook(env: Env, payload: CommentPayload, safeContent: string): Promise<void> {
  try {
    const webhookPayload = {
      event: 'new_comment',
      blog_owner: env.AUTHOR_NAME, // ZGQ
      post: payload.post_slug,
      author: payload.author_name,
      email: payload.author_email,
      content: safeContent
    };

    // 纯 Fetch 发送
    await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload)
    });
  } catch (err) {
    console.error('Failed to trigger email webhook:', err);
  }
}
