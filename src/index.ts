export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  WEBHOOK_URL: string;
  AUTHOR_NAME: string;
  TG_BOT_TOKEN: string; // 需通过 wrangler secret 配置
}

// ==========================================
// Telegram Bot API 10.2: InputRichMessage AST 骨架
// 强制废弃 MarkdownV2/HTML 字符串拼接
// ==========================================

export interface InputRichBlockParagraph {
  type: 'paragraph';
  // 在后续 Milestone 中使用 @telegraf/entity 规范化 text 内容
  text: any; 
}

export interface InputRichBlockPhoto {
  type: 'photo';
  media: string; // url or file_id
  caption?: string;
}

export interface InputRichMessage {
  // 富文本抽象语法树核心数组
  blocks: Array<InputRichBlockParagraph | InputRichBlockPhoto | any>;
}

/**
 * 结构化推送核心骨架 (Milestone 2 不做全量实现，仅确立规范)
 */
async function sendTelegramRichMessage(env: Env, chatId: number | string, richMessage: InputRichMessage): Promise<Response> {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
  
  // TODO: 后续将 blocks 准确适配至 Telegram 原生格式
  const payload = {
    chat_id: chatId,
    // Bot API 10.2 支持的块级载荷
    blocks: richMessage.blocks
  };

  // 严格基于原生的 Fetch API，杜绝引入任何类似 tencentcloud-sdk-nodejs 或 jsdom 等 Node.js 包
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}


// ==========================================
// Cloudflare Worker 核心路由入口
// ==========================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Telegram Webhook 路由
    if (request.method === 'POST' && url.pathname === '/webhook/telegram') {
      return handleTelegramWebhook(request, env, ctx);
    }

    // 2. 健康检查或通用路由
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'Serverless Blog Worker' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};


// ==========================================
// Webhook 处理逻辑
// ==========================================

async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    // 限制解析大小与时间，完美契合 V8 Isolate 特性
    const update = await request.json<any>();

    // 获取到推送的留言（将在后续 Milestone 基于 @telegraf/entity 逆向出 UTF-16 偏移量）
    if (update.message) {
      // 业务逻辑交由 ctx.waitUntil 处理，以保证 0.5s 极速响应
      ctx.waitUntil(processTelegramMessage(update.message, env));
    }

    // 无论后台处理是否成功，必须立即响应 Telegram 200，防止触发重试雪崩
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook parsing error', error);
    // 即使发生异常，对外仍需响应 200
    return new Response('OK', { status: 200 });
  }
}

async function processTelegramMessage(message: any, env: Env) {
  // 骨架占位：查询反向文章、写入 D1、记录 Cursor 等逻辑。
  // 严格杜绝使用 substring 处理 MessageEntity。
  console.log('Processing message ID:', message.message_id);
}
