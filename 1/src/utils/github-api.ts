import { Env } from '../index';

/**
 * 用于在 Cloudflare Worker (V8 Isolate) 中安全的将包含 UTF-8 的字符串转为 Base64
 */
function encodeBase64(str: string): string {
  // Cloudflare Worker 提供 btoa，但为了处理多字节字符，需要先进行 URI 编码转换
  // 注意：在最新 Worker 运行时中可考虑使用 Buffer 库或标准 TextEncoder，这里采用原生兼容方案
  const utf8Bytes = new TextEncoder().encode(str);
  return btoa(String.fromCharCode(...utf8Bytes));
}

/**
 * 通用 GitHub API 包装，自动补齐认证请求头
 */
async function fetchGitHubAPI(env: Env, filename: string, method: string = 'GET', body?: any): Promise<Response> {
  // 假设从 Env 中获取 GITHUB_REPO_OWNER, NAME, PATH 及 TOKEN
  // 这里需你在 Env 类型中追加这些字段，以契合 wrangler.toml 注入的值
  const repoOwner = (env as any).GITHUB_REPO_OWNER || 'ZGQ';
  const repoName = (env as any).GITHUB_REPO_NAME || 'blog-repo';
  const repoPath = (env as any).GITHUB_POSTS_PATH || 'source/_posts';
  
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}/${filename}`;
  const token = (env as any).GITHUB_TOKEN; // 需在 Worker Secret 中配置

  const options: RequestInit = {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Serverless-Blog-Worker-GitOps',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${token}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return fetch(url, options);
}

/**
 * 发布新文章
 * 
 * @param env 环境变量
 * @param filename Markdown 文件名，例如 'hello-world.md'
 * @param content 解析后的 Markdown 正文
 */
export async function createPost(env: Env, filename: string, content: string): Promise<void> {
  const body = {
    message: `feat: publish new post ${filename} via TG Bot`,
    content: encodeBase64(content),
    committer: {
      name: 'ZGQ', // 强制硬编码为 ZGQ
      email: 'bot@example.com' 
    },
    author: {
      name: 'ZGQ', // 强制硬编码为 ZGQ
      email: 'bot@example.com'
    }
  };

  const response = await fetchGitHubAPI(env, filename, 'PUT', body);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub API Create Failed: ${response.status} - ${errText}`);
  }
}

/**
 * 修改文章 (基于 SHA 的乐观锁机制防冲突)
 * 
 * @param env 环境变量
 * @param filename Markdown 文件名
 * @param newContent 修改后的最新 Markdown 正文
 */
export async function updatePost(env: Env, filename: string, newContent: string): Promise<void> {
  // 1. 发起 GET 请求获取底层 blob 的 sha 标识
  const getResponse = await fetchGitHubAPI(env, filename, 'GET');
  if (!getResponse.ok) {
    throw new Error(`GitHub API GET Failed (Cannot fetch SHA): ${getResponse.status}`);
  }
  
  const fileData = await getResponse.json<any>();
  const currentSha = fileData.sha;

  if (!currentSha) {
    throw new Error('Invalid response from GitHub: Missing SHA identifier.');
  }

  // 2. 封装 PUT 请求体，**必须**原样附带 sha 值
  const body = {
    message: `chore: update post ${filename} via TG Bot`,
    content: encodeBase64(newContent),
    sha: currentSha, // 乐观锁核心字段
    committer: {
      name: 'ZGQ', // 强制硬编码为 ZGQ
      email: 'bot@example.com'
    },
    author: {
      name: 'ZGQ', // 强制硬编码为 ZGQ
      email: 'bot@example.com'
    }
  };

  // 3. 提交修改请求
  const putResponse = await fetchGitHubAPI(env, filename, 'PUT', body);
  
  // 4. 严谨的异常与 409 冲突拦截处理
  if (putResponse.status === 409) {
    throw new Error('Conflict [409]: The file has been modified concurrently on GitHub. Optimistic locking triggered.');
  }

  if (!putResponse.ok) {
    const errText = await putResponse.text();
    throw new Error(`GitHub API Update Failed: ${putResponse.status} - ${errText}`);
  }
}
