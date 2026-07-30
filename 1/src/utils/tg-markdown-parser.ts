// 强制引入 @telegraf/entity 库来接管文本解析
// 这将运行在 V8 Isolate 内，无需 Node.js 原生模块
import { serialize } from '@telegraf/entity';

// Telegram Bot API 的原生 Entity 定义
export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: any;
  language?: string;
  custom_emoji_id?: string;
}

export interface TelegramMessagePayload {
  text?: string;
  entities?: MessageEntity[];
}

/**
 * 核心：将 Telegram 消息的纯文本与 UTF-16 Entities 逆向转换为标准 Markdown。
 * 
 * ⚠️ 防雷警告：
 * Telegram 接口下发的 offset 严格对应 UTF-16 Code Units 偏移量。
 * 绝对禁止自行使用 str.substring 或 str.slice。一旦文本中存在 Emoji 或生僻字
 * (Surrogate Pairs, 占用 2 个代码单元)，手工切片会导致 Markdown 标签严重错位甚至截断字符。
 * 
 * @param message 包含 text 和 entities 的载荷
 * @returns 逆向解析出的纯正 Markdown 文本
 */
export function parseTelegramToMarkdown(message: TelegramMessagePayload): string {
  if (!message.text) {
    return '';
  }

  // 若无 entities，直接返回纯文本即可
  if (!message.entities || message.entities.length === 0) {
    return message.text;
  }

  // 依赖 @telegraf/entity 提供的 serialize 核心方法进行组装。
  // 它会在内部进行安全的 UTF-16 边界映射，完全规避手工 substring 的风险。
  // 自定义各类型 Entity 对应的 Markdown 格式化规则
  const markdownResult = serialize(
    { text: message.text, entities: message.entities },
    {
      bold: (text) => `**${text}**`,
      italic: (text) => `*${text}*`,
      strikethrough: (text) => `~~${text}~~`,
      underline: (text) => `<u>${text}</u>`, // 采用 HTML 规避部分 Markdown 解析器不支持下划线
      code: (text) => `\`${text}\``,
      pre: (text, entity) => `\`\`\`${entity.language || ''}\n${text}\n\`\`\``,
      text_link: (text, entity) => `[${text}](${entity.url})`,
      text_mention: (text, entity) => `[${text}](tg://user?id=${entity.user?.id})`,
      mention: (text) => text,
      hashtag: (text) => text,
      cashtag: (text) => text,
      bot_command: (text) => text,
      url: (text) => text,
      email: (text) => text,
      phone_number: (text) => text,
      spoiler: (text) => `<span class="spoiler">${text}</span>`, 
      custom_emoji: (text) => text, // 忽略自定义 Emoji 映射
    }
  );

  return markdownResult;
}
