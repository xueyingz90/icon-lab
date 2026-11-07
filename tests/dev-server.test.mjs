import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDevServer } from '../scripts/dev-server.mjs';
import { MAX_BODY_BYTES, SYSTEM_PROMPT } from '../ai-api.js';
import { validateGeneratedIcons } from '../ai-core.js';

const env = { MODEL_API_URL: 'https://model.invalid/v1/chat/completions', MODEL_API_KEY: 'server-private-test-key', MODEL_NAME: 'test-model' };
const spec = { canvas: 24, stroke: 2, color: '#30343b', cap: 'round', join: 'round', padding: 2, styleNotes: '' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
const reference = { name: '参考', svg: '<svg viewBox="0 0 24 24"/>', preview: png, widths: ['2'], caps: ['round'], joins: ['round'], strokes: ['#30343b'], fills: ['none'], vb: [0, 0, 24, 24] };
const icons = [{ name: '横线', d: 'M6 12 L18 12' }, { name: '竖线', d: 'M12 6 L12 18' }, { name: '折线', d: 'M6 16 L12 8 L18 16' }];
const batch = { icons };
const payload = (operation = 'generate') => ({ operation, references: [reference], ...(operation === 'analyze' ? { target: spec } : { spec, prompt: '横线' }) });
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
function assertValidatedBatch(value) {
  assert.equal(value.icon, undefined);
  assert.equal(value.icons.length, 3);
  assert.deepEqual(value.icons, validateGeneratedIcons(value.icons, spec));
  for (const icon of value.icons) {
    assert.equal(icon.validation.status, 'pass');
    assert.equal(icon.fill, false);
    assert.deepEqual(icon.spec, spec);
  }
}

async function start(t, options = {}) {
  const server = createDevServer({ env, fetcher: async () => completion(batch), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (value = payload(), headers = {}) => fetch(`${origin}/api/icon-ai`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  return { server, origin, post };
}

function rawRequest(origin, pathname, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, res => {
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(data).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function fixtures(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'icon-ai-static-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'icon-ai-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  for (const dir of ['vendor', 'samples', 'backend', 'supabase', 'tests', 'node_modules', '.git']) await mkdir(path.join(root, dir));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await writeFile(path.join(root, 'app.js'), 'export const frontend = true;');
  await writeFile(path.join(root, 'style.css'), 'body{color:black}');
  await writeFile(path.join(root, 'vendor', 'safe.js'), 'export const vendor = true;');
  await writeFile(path.join(root, 'samples', 'safe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const file of ['.env', 'ai-api.js', 'unknown.js', 'backend/secret.js', 'supabase/secret.js', 'tests/secret.js', 'node_modules/secret.js', '.git/config']) await writeFile(path.join(root, file), env.MODEL_API_KEY);
  for (const dir of ['backend', 'supabase', 'tests', 'node_modules']) {
    await mkdir(path.join(root, 'vendor', dir));
    await writeFile(path.join(root, 'vendor', dir, 'secret.js'), env.MODEL_API_KEY);
  }
  await writeFile(path.join(outside, 'secret.js'), env.MODEL_API_KEY);
  await symlink(path.join(outside, 'secret.js'), path.join(root, 'vendor', 'leak.js'));
  await symlink(outside, path.join(root, 'vendor', 'linked'));
  return { root, outside };
}

test('local server analyzes and generates three validated candidates in one configured model call each', async t => {
  const calls = [];
  const { post } = await start(t, { fetcher: async (url, init) => {
    calls.push({ url, init });
    const messages = JSON.parse(init.body).messages;
    assert.ok(messages[0].content.startsWith(SYSTEM_PROMPT));
    assert.ok(messages[0].content.length <= 300);
    const input = JSON.parse(messages[1].content[1].text);
    return completion(input.operation === 'analyze' ? { spec } : batch);
  } });
  const analyze = await post(payload('analyze'));
  assert.equal(analyze.status, 200);
  assert.deepEqual(await analyze.json(), { spec, model: env.MODEL_NAME });
  const generate = await post({ ...payload(), url: 'https://attacker.invalid/chat/completions', key: 'forged', model: 'forged' });
  assert.equal(generate.status, 200);
  const value = await generate.json();
  assertValidatedBatch(value);
  assert.deepEqual(value.icons.map(({ name, d }) => ({ name, d })), icons);
  assert.equal(value.model, env.MODEL_NAME);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, env.MODEL_API_URL);
    assert.equal(call.init.headers.Authorization, `Bearer ${env.MODEL_API_KEY}`);
  }
  assert.equal(generate.headers.get('access-control-allow-origin'), null);
});

test('local server rejects invalid batches after at most one extra model call and returns no partial icons', async t => {
  const invalids = [
    { icons: [] }, { icons: icons.slice(0, 2) }, { icons: [...icons, { name: '斜线', d: 'M6 6L18 18' }] },
    { icons: [icons[0], icons[1], { name: '重复', d: 'M+6.0 1.2e1L18.000 12' }] },
    { icons: [icons[0], { name: '越界', d: 'M0 0L24 24', validation: { status: 'pass' } }, icons[2]] }
  ];
  for (const [index, output] of invalids.entries()) await t.test(`invalid batch ${index + 1}`, async st => {
    let calls = 0;
    const { post } = await start(st, { fetcher: async () => { calls++; return completion(output); } });
    const response = await post();
    assert.equal(response.status, 502);
    const value = await response.json();
    assert.match(value.message, /一次修复/);
    assert.equal(value.icons, undefined);
    assert.equal(value.icon, undefined);
    assert.equal(value.stack, undefined);
    assert.equal(JSON.stringify(value).includes(env.MODEL_API_KEY), false);
    assert.equal(calls, 2);
  });
});

test('missing configuration serves static frontend but AI returns clear 503 without fake outputs', async t => {
  const { origin, post } = await start(t, { env: {}, fetcher: async () => assert.fail('unconfigured model must not run') });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  for (const filename of ['ai-core.js', 'ai-workflow.js']) {
    const module = await fetch(`${origin}/${filename}`);
    assert.equal(module.status, 200, filename);
    assert.match(module.headers.get('content-type'), /javascript/);
  }
  assert.equal((await fetch(`${origin}/ai-api.js`)).status, 404);
  const response = await post();
  assert.equal(response.status, 503);
  const value = await response.json();
  assert.match(value.message, /MODEL_API_URL/);
  assert.match(value.message, /MODEL_API_KEY/);
  assert.match(value.message, /MODEL_NAME/);
  assert.equal(value.icon, undefined);
  assert.equal(value.icons, undefined);
  assert.equal(value.stack, undefined);
});

test('local AI requires exact same-origin POST; no CORS or missing Origin exception', async t => {
  let calls = 0;
  const { origin } = await start(t, { fetcher: async () => { calls++; assert.fail('invalid origins cannot call model'); } });
  for (const Origin of [undefined, 'https://attacker.invalid', origin + '.evil.invalid', 'null']) {
    const headers = { 'Content-Type': 'application/json', ...(Origin ? { Origin } : {}) };
    const response = await fetch(`${origin}/api/icon-ai`, { method: 'POST', headers, body: JSON.stringify(payload()) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const method of ['GET', 'PUT', 'OPTIONS']) {
    const response = await fetch(`${origin}/api/icon-ai`, { method, headers: { Origin: origin } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
  assert.equal(calls, 0);
});

test('loopback Host is restricted to the listening port to prevent DNS rebinding', async t => {
  const { origin } = await start(t);
  for (const Host of ['attacker.invalid', '127.0.0.1:999', 'localhost.evil.invalid:4173', 'user@127.0.0.1:4173']) {
    const response = await rawRequest(origin, '/', { headers: { Host } });
    assert.equal(response.status, 403);
    assert.equal(response.text.includes(env.MODEL_API_KEY), false);
  }
  const port = new URL(origin).port;
  const local = await rawRequest(origin, '/', { headers: { Host: `localhost:${port}` } });
  assert.equal(local.status, 200);
});

test('local HTTP transport returns proper statuses for schema, media type and malformed JSON', async t => {
  let calls = 0;
  const { origin, post } = await start(t, { fetcher: async () => { calls++; assert.fail('invalid inputs cannot call model'); } });
  assert.equal((await post({ operation: 'generate' })).status, 400);
  assert.equal((await post(payload(), { 'Content-Type': 'text/plain' })).status, 415);
  const invalid = await fetch(`${origin}/api/icon-ai`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${origin}/api/unknown`)).status, 404);
  assert.equal(calls, 0);
});

test('local HTTP boundary enforces 2MB declared and actual/chunked UTF8 bytes', async t => {
  const { origin } = await start(t, { fetcher: async () => assert.fail('oversized requests cannot call model') });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const declared = await rawRequest(origin, '/api/icon-ai', { method: 'POST', headers: { ...headers, 'Content-Length': String(MAX_BODY_BYTES + 1) }, chunks: ['{}'] });
  assert.equal(declared.status, 413);
  const streamed = await rawRequest(origin, '/api/icon-ai', { method: 'POST', headers, chunks: ['{"x":"', '中'.repeat(700000), '"}'] });
  assert.equal(streamed.status, 413);
  assert.equal(streamed.text.includes(env.MODEL_API_KEY), false);
});

test('static allowlist serves only actual frontend and vendor/samples assets, never keys or server code', async t => {
  const { root } = await fixtures(t);
  const { origin } = await start(t, { root });
  for (const pathname of ['/', '/index.html', '/app.js?v=1', '/style.css', '/vendor/safe.js', '/samples/safe.svg']) {
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await response.text()).includes(env.MODEL_API_KEY), false);
  }
  for (const pathname of ['/.env', '/.git/config', '/ai-api.js', '/unknown.js', '/backend/secret.js', '/supabase/secret.js', '/tests/secret.js', '/node_modules/secret.js', '/package.json', '/scripts/dev-server.mjs', '/vendor/.env', '/vendor/', '/library/secret.js', '/vendor/backend/secret.js', '/vendor/supabase/secret.js', '/vendor/tests/secret.js', '/vendor/node_modules/secret.js']) {
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 404, pathname);
    assert.equal((await response.text()).includes(env.MODEL_API_KEY), false);
  }
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');
  const post = await fetch(origin, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('static path traversal, double encoding, backslash and symlink files/directories are rejected', async t => {
  const { root, outside } = await fixtures(t);
  const { origin } = await start(t, { root });
  for (const pathname of ['/../.env', '/vendor/../ai-api.js', '/vendor/%2e%2e/ai-api.js', '/vendor/%252e%252e/ai-api.js', '/vendor/%5c../ai-api.js', '/vendor/%00safe.js', '/vendor/leak.js', '/vendor/linked/secret.js']) {
    const response = await rawRequest(origin, pathname);
    assert.equal(response.status, 403, pathname);
    assert.equal(response.text.includes(env.MODEL_API_KEY), false);
  }
  const invalidEncoding = await rawRequest(origin, '/vendor/%zz');
  assert.equal(invalidEncoding.status, 400);
  await unlink(path.join(root, 'app.js'));
  await symlink(path.join(outside, 'secret.js'), path.join(root, 'app.js'));
  const linkedRootFile = await fetch(`${origin}/app.js`);
  assert.equal(linkedRootFile.status, 403);
});

test('local server masks model HTTP/network errors and returns no stack, key or upstream body', async t => {
  const { post } = await start(t, { fetcher: async () => new Response(`private upstream ${env.MODEL_API_KEY}`, { status: 401 }) });
  const response = await post();
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes(env.MODEL_API_KEY), false);
  assert.equal(text.includes('private upstream'), false);
  assert.equal(text.includes('stack'), false);
  const { post: offline } = await start(t, { fetcher: async () => { throw Error(env.MODEL_API_KEY); } });
  const disconnected = await offline();
  assert.equal(disconnected.status, 502);
  assert.equal((await disconnected.text()).includes(env.MODEL_API_KEY), false);
});

test('local quota limits each loopback address to 30/hour, request 31 does not call the model', async t => {
  let calls = 0;
  const { post } = await start(t, { fetcher: async () => { calls++; return completion(batch); } });
  for (let i = 0; i < 30; i++) assert.equal((await post()).status, 200);
  const response = await post();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(calls, 30);
});

test('local model concurrency is at most two, with slots released even on upstream failures', async t => {
  const resolvers = [];
  let ready, hold = true, calls = 0;
  const twoStarted = new Promise(resolve => { ready = resolve; });
  const { post } = await start(t, { fetcher: async () => {
    calls++;
    if (!hold) return completion(batch);
    return new Promise(resolve => { resolvers.push(resolve); if (resolvers.length === 2) ready(); });
  } });
  const first = post(), second = post();
  await twoStarted;
  assert.equal((await post()).status, 429);
  resolvers[0](new Response('private failure', { status: 500 }));
  resolvers[1](completion(batch));
  assert.equal((await first).status, 502);
  assert.equal((await second).status, 200);
  hold = false;
  assert.equal((await post()).status, 200);
  assert.equal(calls, 3);
});

test('local Qoder routing preserves human-confirmed spec, repairs once and never exposes server credentials', async t => {
  const values = { AI_PROVIDER: 'qoder', QODER_PAT: 'pt-local-private-test', QODER_AGENT_ID: 'agent_test', QODER_ENVIRONMENT_ID: 'env_test' };
  const sessions = new Map(), eventBatches = [];
  const previous = { icons: [icons[0], { name: '越界', d: 'M0 0 L24 24' }, icons[2]] };
  let sequence = 0, archived = 0;
  const { origin, post } = await start(t, { env: values, fetcher: async (url, init) => {
    assert.equal(url.startsWith('https://api.qoder.com/api/v1/cloud/'), true);
    assert.equal(init.headers.Authorization, `Bearer ${values.QODER_PAT}`);
    const pathname = new URL(url).pathname.replace('/api/v1/cloud', '');
    if (pathname === '/agents/agent_test') return Response.json({ id: 'agent_test', type: 'agent', version: 1, model: 'ultimate', tools: [], mcp_servers: [], skills: [], multiagent: null });
    if (pathname === '/sessions') {
      const id = `sess_test${++sequence}`;
      sessions.set(id, {});
      return Response.json({ id, type: 'session' });
    }
    const id = pathname.split('/')[2];
    if (pathname.endsWith('/archive')) { archived++; return Response.json({ id, type: 'session', status: 'idle' }); }
    if (pathname.endsWith('/events')) {
      const events = JSON.parse(init.body).events;
      eventBatches.push(events);
      assert.equal(JSON.stringify(events).includes(values.QODER_PAT), false);
      const input = JSON.parse(events[0].content[1].text);
      const repair = events[0].content.some(block => block.type === 'text' && block.text.includes('唯一一次修复'));
      sessions.set(id, input.operation === 'analyze' ? { spec } : repair ? batch : previous);
      return Response.json({ data: [{ id: 'evt_user', type: 'user.message' }, { id: 'evt_system', type: 'system.message' }] });
    }
    assert.equal(pathname.endsWith('/events/stream'), true);
    return new Response([
      { type: 'agent.message', content: [{ type: 'text', text: JSON.stringify(sessions.get(id)) }] },
      { type: 'session.status_idle', stop_reason: { type: 'end_turn' } }
    ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal((await post(payload('analyze'))).status, 200);
  const response = await post({ ...payload(), AI_PROVIDER: 'openai', QODER_PAT: 'forged', QODER_AGENT_ID: 'agent_forged' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.model, 'qoder/ultimate');
  assertValidatedBatch(result);
  assert.deepEqual(result.icons.map(({ name, d }) => ({ name, d })), icons);
  assert.equal(sequence, 3);
  assert.equal(archived, 3);
  assert.equal(eventBatches.length, 3);
  const [, first, repair] = eventBatches;
  assert.deepEqual(repair[1], first[1]);
  assert.deepEqual(repair[0].content.slice(0, first[0].content.length), first[0].content);
  const repairText = repair[0].content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  assert.ok(repairText.includes(JSON.stringify(previous)));
  assert.match(repairText, /校验/);
  assert.match(repairText, /唯一一次/);
  assert.match(repairText, /数据.*(?:而非|不是|非)指令/);
  assert.equal(JSON.stringify(result).includes(values.QODER_PAT), false);
  for (const filename of ['.env', 'ai-api.js']) assert.equal((await fetch(`${origin}/${filename}`)).status, 404);
});

test('missing Qoder configuration reports Qoder settings without OpenAI fallback or external calls', async t => {
  const { post } = await start(t, { env: { ...env, AI_PROVIDER: 'qoder' }, fetcher: async () => assert.fail('missing Qoder settings cannot call upstream') });
  const response = await post();
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'qoder_unconfigured');
  assert.match(result.message, /QODER_PAT/);
});
