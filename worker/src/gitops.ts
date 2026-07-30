import { broadcastToTelegram } from './telegram-sync';
import { Env } from './index';

// =============================================================================
// Phase 4: GitHub REST API GitOps (Optimistic Locking)
// Author: ZGQ Inc.
// 
// Endpoints:
//   GET  /api/admin/sha   → Fetch current blob sha for a file (乐观锁前置步骤)
//   PUT  /api/admin/publish → Create or update a file with sha (乐观锁保护)
// =============================================================================

// ─── Helper: GitHub API base URL ─────────────────────────────────────────────
function githubContentsUrl(env: Env, path: string): string {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function githubHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Serverless-Blog-Worker/1.0 (ZGQ Inc.)',
    'Content-Type': 'application/json',
  };
}

// ─── GET /api/admin/sha ───────────────────────────────────────────────────────
// Returns the current `sha` for a file in the GitHub repository.
// MUST be called before any PUT to update an existing file (乐观锁凭据).
export async function handleGitOpsGetSha(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return Response.json({ error: 'Query param `path` is required' }, { status: 400 });
  }

  try {
    const apiUrl = githubContentsUrl(env, filePath);
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: githubHeaders(env),
    });

    if (res.status === 404) {
      // File doesn't exist yet — return empty sha (new file)
      return Response.json({ sha: null, exists: false });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub GET Error [${res.status}]: ${err}`);
    }

    const data = (await res.json()) as any;
    return Response.json({ sha: data.sha, exists: true, name: data.name });
  } catch (error: any) {
    console.error('[GitOps GET SHA] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ─── PUT /api/admin/publish ───────────────────────────────────────────────────
// Creates or updates a file in the GitHub repository.
// Request body:
//   { path: string, content: string (raw markdown), sha?: string,
//     message?: string, title?: string, tags?: string[], postUrl?: string,
//     broadcast?: boolean }
export async function handleGitOpsPublish(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as any;
    const { path, content, sha, message, title, tags, postUrl, broadcast } = body;

    if (!path || !content) {
      return Response.json({ error: '`path` and `content` are required' }, { status: 400 });
    }

    // 1. Encode Markdown content as Base64
    //    btoa() + encodeURIComponent handles full UTF-8 including Chinese characters
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const apiUrl = githubContentsUrl(env, path);

    // 2. Build PUT payload with ZGQ as committer and author
    const gitPayload: any = {
      message: message || `docs: publish ${path}`,
      content: base64Content,
      // Author = ZGQ Inc., Committer = ZGQ Inc.
      committer: { name: 'ZGQ', email: 'zgq@zgq.blog' },
      author: { name: 'ZGQ', email: 'zgq@zgq.blog' },
    };

    // 3. 修改文章防冲突 (Optimistic Lock):
    //    如果提供了 sha，说明是更新已有文件，必须原样附带 sha 以实现乐观锁
    //    GitHub 会在服务器端校验 sha，若文件已被其他进程修改则返回 409 Conflict
    if (sha) {
      gitPayload.sha = sha;
    }

    const githubRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: githubHeaders(env),
      body: JSON.stringify(gitPayload),
    });

    // Handle conflict: Another process updated the file between GET sha and PUT
    if (githubRes.status === 409) {
      return Response.json(
        {
          error: 'CONFLICT',
          message:
            'File was modified by another process. Re-fetch the latest sha and retry.',
          hint: 'Call GET /api/admin/sha?path=<path> to refresh sha before retrying.',
        },
        { status: 409 }
      );
    }

    if (!githubRes.ok) {
      const err = await githubRes.text();
      throw new Error(`GitHub PUT Error [${githubRes.status}]: ${err}`);
    }

    const result = (await githubRes.json()) as any;
    const newSha: string = result?.content?.sha ?? '';

    // 4. Upsert the posts registry in D1 with the new sha
    //    This keeps D1 in sync with GitHub blob state
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO posts (post_slug, github_sha, title, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(post_slug) DO UPDATE SET
         github_sha = excluded.github_sha,
         title = excluded.title,
         updated_at = excluded.updated_at`
    )
      .bind(path, newSha, title ?? null, now)
      .run();

    // 5. Optionally broadcast the new/updated post to Telegram channel
    let tgMessageId: number | null = null;
    if (broadcast && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      tgMessageId = await broadcastToTelegram(env, {
        postTitle: title || path,
        postSummary: content.slice(0, 200).replace(/^---[\s\S]*?---\n/, '').trim(),
        postUrl: postUrl || `https://zgq.blog/${path}`,
        postSlug: path,
        tags: tags ?? [],
      });
    }

    return Response.json({
      success: true,
      sha: newSha,
      tg_message_id: tgMessageId,
    });
  } catch (error: any) {
    console.error('[GitOps Publish] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
