-- 博客评论表 (Blog Comments)
-- 存储博客的评论数据，支持树状嵌套与 Telegram 消息的双向绑定
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_slug TEXT NOT NULL,           -- 关联的博客文章 Slug
    author_name TEXT NOT NULL,         -- 评论者昵称
    author_email TEXT,                 -- 评论者邮箱 (可选)
    author_website TEXT,               -- 评论者网站 (可选)
    content TEXT NOT NULL,             -- 评论正文 (处理好 XSS 的纯文本或受限 HTML)
    parent_id TEXT,                    -- 父评论 ID，用于支持楼中楼回复
    tg_message_id INTEGER,             -- 对应的 Telegram 讨论组 Message ID，用于双向同步反查
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    is_admin INTEGER NOT NULL DEFAULT 0 -- 标识是否为博主 (ZGQ) 本人的回复
);
CREATE INDEX IF NOT EXISTS idx_comments_post_slug ON comments(post_slug);
CREATE INDEX IF NOT EXISTS idx_comments_tg_msg ON comments(tg_message_id);

-- Telegram用户映射表 (Telegram User Mapping)
-- 映射 Telegram 侧的用户信息，用于控制信任域或权限
CREATE TABLE IF NOT EXISTS tg_users (
    tg_user_id INTEGER PRIMARY KEY,    -- Telegram User ID
    tg_username TEXT,                  -- Telegram @username
    display_name TEXT NOT NULL,        -- 显示名称
    mapped_email TEXT,                 -- 绑定的邮箱 (若有)
    is_trusted INTEGER NOT NULL DEFAULT 0, -- 信任标识 (例如防垃圾评论)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 同步游标表 (Synchronization Cursor)
-- 记录 Telegram Bot 获取 Updates 的 offset 游标，防止重启丢失或重复消费
CREATE TABLE IF NOT EXISTS sync_cursors (
    id TEXT PRIMARY KEY,               -- 标识游标类型，例如 'tg_update_offset'
    cursor_value INTEGER NOT NULL,     -- 游标具体数值
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
