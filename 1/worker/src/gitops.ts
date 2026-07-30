// Phase 4: GitHub REST API GitOps (Optimistic Locking)
export async function handleGitOpsPublish(request: Request, env: any): Promise<Response> {
  try {
    const body = await request.json() as any;
    // content: raw markdown to be published/updated
    const { path, content, sha, message } = body;
    
    // 1. Convert Markdown to Base64 
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const url = `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/contents/${path}`;
    
    const payload: any = {
      message: message || `docs: update ${path}`,
      content: base64Content,
      // 封装 Committer 与 Author 为 ZGQ
      committer: { name: "ZGQ", email: "zgq@serverless-blog.local" },
      author: { name: "ZGQ", email: "zgq@serverless-blog.local" }
    };

    // 2. 修改文章 (防冲突): 乐观锁强制要求
    // 如果是更新文章，PUT 请求体中必须原样附带底层 blob 的 `sha` 标识
    if (sha) {
      payload.sha = sha;
    }

    const githubRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Serverless-Blog-Worker'
      },
      body: JSON.stringify(payload)
    });

    if (githubRes.status === 409) {
      // 拦截 409 Conflict，要求前端获取最新 sha
      return new Response(JSON.stringify({ 
        error: 'Conflict: File has been modified by another process. Please re-fetch the latest sha.' 
      }), { status: 409 });
    }

    if (!githubRes.ok) {
      const err = await githubRes.text();
      throw new Error(`GitHub API Error: ${err}`);
    }

    const result = await githubRes.json();
    return Response.json({ success: true, data: result });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
