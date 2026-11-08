import http from 'node:http';
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AIError, MODEL_CONFIG_MESSAGE, createAIProvider, handleAIRequest, readJSONBody, createRequestLimiter } from '../ai-api.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const frontFiles = new Set([
  'index.html', 'app.js', 'style.css', 'library.js', 'taxonomy.js', 'asset-library.js', 'asset-library.css',
  'catalog-core.js', 'standards-core.js', 'standards-ui.js', 'cloud-client.js', 'cloud-config.js', 'ai-core.js', 'ai-workflow.js', 'personal-qoder-ui.js'
]);
const privateDirectories = new Set(['node_modules', 'backend', 'supabase', 'tests', 'scripts', 'docs', 'figma-plugin']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2'
};
const loopbackAddress = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

function sendJSON(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(status === 429 ? { 'Retry-After': '60' } : {})
  });
  res.end(JSON.stringify(value));
}

function checkHost(req, port) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !loopbackAddress(req.socket.remoteAddress)) throw new AIError(403, '仅允许本机访问。', 'invalid_host');
  let url;
  try { url = new URL(`http://${host}`); } catch { throw new AIError(403, 'Host 不被允许。', 'invalid_host'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      Number(url.port || 80) !== port || host !== url.host) {
    throw new AIError(403, 'Host 不被允许。', 'invalid_host');
  }
  return url.origin;
}

function requestPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) throw new AIError(400, '请求路径无效。', 'invalid_path');
  let pathname;
  try { pathname = decodeURIComponent(raw.split('?')[0]); } catch { throw new AIError(400, '请求路径编码无效。', 'invalid_path'); }
  if (/[\\%\u0000-\u001f\u007f]/.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..')) {
    throw new AIError(403, '禁止访问此路径。', 'invalid_path');
  }
  return pathname;
}

async function serveStatic(root, pathname, req, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const parts = relative.split('/');
  const extension = path.extname(relative).toLowerCase();
  const allowed = frontFiles.has(relative) ||
    (['vendor', 'samples'].includes(parts[0]) && parts.length > 1 && extension !== '.html' && Object.hasOwn(mime, extension));
  if (!allowed || parts.some(part => !part || part.startsWith('.') || privateDirectories.has(part.toLowerCase()))) throw new AIError(404, '文件不存在。', 'not_found');
  const base = await realpath(root);
  let filename = base;
  for (const part of parts) {
    filename = path.join(filename, part);
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw new AIError(403, '禁止访问符号链接。', 'invalid_path');
  }
  if (await realpath(filename) !== filename) throw new AIError(403, '禁止访问符号链接。', 'invalid_path');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new AIError(404, '文件不存在。', 'not_found');
    const bytes = req.method === 'HEAD' ? null : await file.readFile();
    res.writeHead(200, {
      'Content-Type': mime[extension], 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin'
    });
    res.end(bytes);
  } finally { await file.close(); }
}

export function createDevServer({ env = process.env, fetcher = globalThis.fetch, root = projectRoot } = {}) {
  let callModel, model, configError;
  try { ({ callModel, model } = createAIProvider(env, { fetcher })); }
  catch (error) { configError = error instanceof AIError ? error : new AIError(503, MODEL_CONFIG_MESSAGE, 'model_unconfigured'); }
  const acquire = createRequestLimiter();
  let active = 0;
  const server = http.createServer(async (req, res) => {
    let release;
    try {
      const origin = checkHost(req, server.address()?.port);
      const pathname = requestPath(req.url);
      if (pathname === '/api/icon-ai') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          throw new AIError(405, 'AI 接口仅允许 POST 请求。', 'method_not_allowed');
        }
        if (req.headers.origin !== origin) throw new AIError(403, 'AI 接口需要同源 Origin，拒绝无来源或跨域请求。', 'invalid_origin');
        const body = await readJSONBody(req.iterator({ destroyOnReturn: false }), {
          contentType: req.headers['content-type'], contentLength: req.headers['content-length']
        });
        if (configError) throw configError;
        if (active >= 2) throw new AIError(429, '最多同时处理 2 次请求，请稍后重试。', 'rate_limited');
        release = acquire(req.socket.remoteAddress === '::1' ? '::1' : '127.0.0.1');
        active += 1;
        const result = await handleAIRequest(body, { callModel, model });
        sendJSON(res, 200, result);
      } else {
        if (pathname === '/api' || pathname.startsWith('/api/')) throw new AIError(404, '接口不存在。', 'not_found');
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.setHeader('Allow', 'GET, HEAD');
          throw new AIError(405, '静态文件仅允许 GET 或 HEAD。', 'method_not_allowed');
        }
        await serveStatic(root, pathname, req, res);
      }
    } catch (error) {
      const safe = error instanceof AIError ? error :
        ['ENOENT', 'ENOTDIR'].includes(error?.code) ? new AIError(404, '文件不存在。', 'not_found') : new AIError(500, '服务器处理失败，请稍后重试。', 'internal_error');
      if (!res.headersSent && !res.destroyed) {
        if (!req.complete) { res.setHeader('Connection', 'close'); req.resume(); }
        sendJSON(res, safe.status, { message: safe.message, code: safe.code });
      } else if (!res.writableEnded) res.end();
    } finally {
      if (release) { active -= 1; release(); }
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 65000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1–65535 的整数。');
    process.exitCode = 1;
  } else {
    const server = createDevServer();
    server.on('error', () => { console.error('本地服务器启动失败，请检查端口。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Icon Lab: http://127.0.0.1:${port}`));
  }
}
