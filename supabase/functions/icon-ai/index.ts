import { AIError, MAX_BODY_BYTES, createAIProvider, handleAIRequest, readJSONBody, createRequestLimiter } from '../../../ai-api.js';

type EdgeOptions = { env?: { get(name: string): string | undefined }; fetcher?: typeof fetch };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOrigins(value: string | undefined): Set<string> {
  const values = value?.trim().split(/[,\s]+/).filter(Boolean) || [];
  if (!values.length || values.some(origin => {
    try {
      const url = new URL(origin);
      return !['https:', 'http:'].includes(url.protocol) || origin !== url.origin;
    } catch { return true; }
  })) throw new AIError(503, '请配置 AI_ALLOWED_ORIGINS 精确来源白名单，不允许 *。', 'access_unconfigured');
  return new Set(values);
}

function accessConfig(env: NonNullable<EdgeOptions['env']>) {
  const ids = env.get('AI_ALLOWED_USER_IDS')?.trim().split(/[,\s]+/).filter(Boolean) || [];
  if (!ids.length || ids.some(id => !uuid.test(id))) throw new AIError(503, '请配置 AI_ALLOWED_USER_IDS 用户 UUID 白名单，默认拒绝访问。', 'access_unconfigured');
  let url: URL;
  try { url = new URL(env.get('SUPABASE_URL') || ''); }
  catch { throw new AIError(503, '请配置 SUPABASE_URL 和 SUPABASE_ANON_KEY。', 'auth_unconfigured'); }
  const key = env.get('SUPABASE_ANON_KEY');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !key?.trim() || /[\r\n]/.test(key)) {
    throw new AIError(503, '请配置有效的 SUPABASE_URL 和 SUPABASE_ANON_KEY。', 'auth_unconfigured');
  }
  return { users: new Set(ids.map(id => id.toLowerCase())), url: new URL('/auth/v1/user', url).href, key };
}

async function authenticatedUser(token: string | null, config: ReturnType<typeof accessConfig>, fetcher: typeof fetch): Promise<string> {
  if (!token || token.length > 8192 || !/^Bearer [^\s]+$/i.test(token)) throw new AIError(401, '请先登录并提供有效的 Bearer 登录令牌。', 'unauthorized');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const user = await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new AIError(503, '登录验证超时，请稍后重试。', 'auth_unavailable')); }, 10000);
      }),
      (async () => {
        const response = await fetcher(config.url, {
          method: 'GET', redirect: 'error', headers: { Authorization: token, apikey: config.key }, signal: controller.signal
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status)) throw new AIError(401, '登录已失效，请重新登录。', 'unauthorized');
          throw new AIError(503, '登录验证服务暂不可用。', 'auth_unavailable');
        }
        try { return await readJSONBody(response.body, { contentType: 'application/json', contentLength: response.headers.get('content-length') }); }
        catch { throw new AIError(503, '登录验证服务返回无效响应。', 'auth_unavailable'); }
      })()
    ]);
    if (!user || typeof user.id !== 'string' || !uuid.test(user.id)) throw new AIError(401, '登录验证未通过。', 'unauthorized');
    const id = user.id.toLowerCase();
    if (!config.users.has(id)) throw new AIError(403, '此账号未获准使用 AI 功能。', 'user_not_allowed');
    return id;
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw new AIError(503, '登录验证服务暂不可用。', 'auth_unavailable');
  } finally { clearTimeout(timer); }
}

export function createEdgeHandler({ env = Deno.env, fetcher = globalThis.fetch }: EdgeOptions = {}) {
  const acquire = createRequestLimiter();
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
    let release: (() => void) | undefined;
    try {
      const origin = request.headers.get('Origin');
      if (!origin) throw new AIError(403, '必须提供获准的 Origin。', 'invalid_origin');
      if (!parseOrigins(env.get('AI_ALLOWED_ORIGINS')).has(origin)) throw new AIError(403, '此来源未获准访问 AI 接口。', 'invalid_origin');
      headers.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const requestedHeaders = request.headers.get('Access-Control-Request-Headers')?.toLowerCase().split(',').map(v => v.trim()) || [];
        if (method !== 'POST' || requestedHeaders.some(v => !['authorization', 'content-type', 'apikey', 'x-client-info'].includes(v))) {
          throw new AIError(403, '预检仅允许 POST 和必要的鉴权/JSON 请求头。', 'invalid_preflight');
        }
        headers.set('Access-Control-Allow-Methods', 'POST');
        headers.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
        headers.set('Access-Control-Max-Age', '600');
        headers.delete('Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') {
        headers.set('Allow', 'POST, OPTIONS');
        throw new AIError(405, 'AI 接口仅允许 POST。', 'method_not_allowed');
      }
      const contentLength = request.headers.get('Content-Length');
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
        throw new AIError(413, '请求正文不能超过 2MB。', 'body_too_large');
      }
      const body = await readJSONBody(request.body, { contentType: request.headers.get('Content-Type'), contentLength });
      const user = await authenticatedUser(request.headers.get('Authorization'), accessConfig(env), fetcher);
      const { callModel, model } = createAIProvider(env, { fetcher });
      release = acquire(user);
      const result = await handleAIRequest(body, { callModel, model });
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      const safe = error instanceof AIError ? error : new AIError(500, '服务器处理失败，请稍后重试。', 'internal_error');
      if (safe.status === 429) headers.set('Retry-After', '60');
      return new Response(JSON.stringify({ message: safe.message, code: safe.code }), { status: safe.status, headers });
    } finally { release?.(); }
  };
}

Deno.serve(createEdgeHandler());
