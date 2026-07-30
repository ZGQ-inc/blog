-- =============================================================================
-- Serverless Blog & Forum — Cloudflare D1 Schema
-- Author: ZGQ Inc. | Engine: SQLite (D1)
-- =============================================================================

-- 博客评论表 (Blog Comments)
-- 存储博客的评论数据，支持树状嵌套与 Telegram 消息的双向绑定
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,                     -- UUID v4, 由 Worker crypto.randomUUID() 生成
    post_slug TEXT NOT NULL,                 -- 关联的博客文章 Slug (例如: 2024/01/my-post)
    author_name TEXT NOT NULL,               -- 评论者昵称
    author_email TEXT,                       -- 评论者邮箱 (可选, 用于 Gravatar)
    author_website TEXT,                     -- 评论者网站 (可选)
    content TEXT NOT NULL,                   -- 评论正文 (经 xss 库清洗的受限 HTML)
    parent_id TEXT,                          -- 父评论 ID，支持楼中楼嵌套回复
    tg_message_id INTEGER,                   -- 对应的 Telegram 讨论组 Message ID (双向同步反查)
    is_admin INTEGER NOT NULL DEFAULT 0,     -- 1 = 博主 ZGQ 本人回复
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (parent_id) REFERENCES comments(id)
);
CREATE INDEX IF NOT EXISTS idx_comments_post_slug ON comments(post_slug);
CREATE INDEX IF NOT EXISTS idx_comments_tg_msg ON comments(tg_message_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- 文章注册表 (Posts Registry)
-- 跟踪 GitHub 仓库中文章 Blob 的 sha 值，用于 GitOps 乐观锁
CREATE TABLE IF NOT EXISTS posts (
    post_slug TEXT PRIMARY KEY,              -- 文章标识 (例如: _posts/2024-01-hello.md)
    github_sha TEXT NOT NULL,                -- GitHub REST API 返回的 blob sha (乐观锁凭据)
    title TEXT,                              -- 文章标题 (缓存用)
    tg_channel_message_id INTEGER,           -- 广播到 Telegram 频道后的 Message ID
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Telegram 用户映射表 (Telegram User Mapping)
-- 映射 Telegram 侧的用户信息，用于控制信任域或权限
CREATE TABLE IF NOT EXISTS tg_users (
    tg_user_id INTEGER PRIMARY KEY,          -- Telegram User ID
    tg_username TEXT,                        -- Telegram @username
    display_name TEXT NOT NULL,              -- 显示名称
    mapped_email TEXT,                       -- 绑定的邮箱 (若有)
    is_trusted INTEGER NOT NULL DEFAULT 0,   -- 信任标识 (例如防垃圾评论)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 同步游标表 (Synchronization Cursor)
-- 记录 Telegram Bot 获取 Updates 的 offset 游标，防止重启丢失或重复消费
CREATE TABLE IF NOT EXISTS sync_cursors (
    id TEXT PRIMARY KEY,                     -- 游标类型标识，例如 'tg_update_offset'
    cursor_value INTEGER NOT NULL,           -- 游标具体数值
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
