// Run: node --experimental-strip-types --no-warnings test/client.test.ts
import assert from 'node:assert/strict';
import {
  generateScene,
  SceneClientError,
  summarizeUsage,
  checkServerHealth,
  DEFAULT_API_URL,
  DEFAULT_HEALTH_URL,
} from '../src/dsl/client.ts';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error('    ', e instanceof Error ? e.stack ?? e.message : e);
    fail++;
  }
}

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;
let lastRequest: { url: string; init?: RequestInit } | null = null;

function installFetch(impl: FakeFetch) {
  lastRequest = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = (url: string, init?: RequestInit) => {
    lastRequest = { url, init };
    return impl(url, init);
  };
}

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

console.log('\n== DSL Client Tests ==\n');

await test('success: server dsl compiles to elements', async () => {
  installFetch(() =>
    Promise.resolve(
      mockResponse({
        dsl: 'col x=0 y=0 w=800 h=400 { rect w=100 h=50 bg=#fff }',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 2000,
        },
        durationMs: 1234,
      })
    )
  );
  const out = await generateScene({ userMessage: 'draw something' });
  assert.ok(Array.isArray(out.elements));
  assert.ok(out.elements.length >= 1);
  assert.ok(out.dsl.includes('rect'));
  assert.ok(out.usage);
  assert.ok(out.usage!.savingsPct > 50);
  assert.equal(out.durationMs, 1234);
});

await test('request: URL is default, method POST, JSON body', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: 'col { }' })));
  await generateScene({ userMessage: 'x' });
  assert.ok(lastRequest);
  assert.equal(lastRequest!.url, DEFAULT_API_URL);
  assert.equal(lastRequest!.init!.method, 'POST');
  const headers = lastRequest!.init!.headers as Record<string, string>;
  assert.equal(headers['content-type'], 'application/json');
});

await test('request: custom apiUrl overrides default', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: 'col { }' })));
  await generateScene({ userMessage: 'x', apiUrl: 'http://elsewhere/gen' });
  assert.equal(lastRequest!.url, 'http://elsewhere/gen');
});

await test('request: body passes userMessage + currentSceneDsl + model', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: 'col { }' })));
  await generateScene({
    userMessage: 'add a rectangle',
    currentSceneDsl: 'col { rect }',
    model: 'haiku',
  });
  const body = JSON.parse(lastRequest!.init!.body as string);
  assert.equal(body.userMessage, 'add a rectangle');
  assert.equal(body.currentSceneDsl, 'col { rect }');
  assert.equal(body.model, 'haiku');
});

await test('error: empty prompt → empty without fetch', async () => {
  let fetched = false;
  installFetch(() => {
    fetched = true;
    return Promise.resolve(mockResponse({}));
  });
  await assert.rejects(
    generateScene({ userMessage: '   ' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'empty'
  );
  assert.equal(fetched, false);
});

await test('error: fetch throws → server_unreachable', async () => {
  installFetch(() => Promise.reject(new TypeError('fetch failed')));
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'server_unreachable'
  );
});

await test('error: 502 claude_failed → claude_failed kind', async () => {
  installFetch(() =>
    Promise.resolve(
      mockResponse({ error: { kind: 'claude_failed', message: 'claude exited 1' } }, 502)
    )
  );
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) =>
      e instanceof SceneClientError && e.kind === 'claude_failed' && e.status === 502
  );
});

await test('error: 502 claude_timeout → claude_timeout kind', async () => {
  installFetch(() =>
    Promise.resolve(
      mockResponse({ error: { kind: 'claude_timeout', message: 'timed out' } }, 502)
    )
  );
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'claude_timeout'
  );
});

await test('error: 400 bad_request → bad_request kind', async () => {
  installFetch(() =>
    Promise.resolve(mockResponse({ error: { kind: 'bad_request', message: 'bad' } }, 400))
  );
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'bad_request'
  );
});

await test('error: 500 → server_error', async () => {
  installFetch(() => Promise.resolve(mockResponse({}, 500)));
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'server_error'
  );
});

await test('error: server returns empty dsl → parse error', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: '' })));
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'parse'
  );
});

await test('error: server returns broken dsl → compile error', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: 'col { rect x=(((' })));
  await assert.rejects(
    generateScene({ userMessage: 'x' }),
    (e: unknown) => e instanceof SceneClientError && e.kind === 'compile'
  );
});

await test('compile options passed through (extraHandlers)', async () => {
  installFetch(() =>
    Promise.resolve(mockResponse({ dsl: 'badge x=0 y=0 label="hi"' }))
  );
  const out = await generateScene({
    userMessage: 'x',
    compile: {
      extraHandlers: {
        badge: (_n, _b, _c, els) => els.push({ type: 'custom-badge' }),
      },
    },
  });
  assert.equal((out.elements[0] as { type: string }).type, 'custom-badge');
});

await test('usage absent → null', async () => {
  installFetch(() => Promise.resolve(mockResponse({ dsl: 'col { rect }' })));
  const out = await generateScene({ userMessage: 'x' });
  assert.equal(out.usage, null);
});

await test('summarizeUsage: pure cache hit → ~90% savings', () => {
  const u = summarizeUsage({
    input_tokens: 20,
    output_tokens: 100,
    cache_read_input_tokens: 3000,
    cache_creation_input_tokens: 0,
  });
  assert.ok(u);
  assert.equal(u!.inputTokens, 20);
  assert.equal(u!.outputTokens, 100);
  assert.ok(u!.savingsPct >= 85);
  assert.equal(u!.effectiveInputTokens, 20 + 300);
});

await test('summarizeUsage: cache creation counts at 1x', () => {
  const u = summarizeUsage({
    input_tokens: 0,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 1000,
  });
  assert.equal(u!.effectiveInputTokens, 1000);
  assert.equal(u!.savingsPct, 0);
});

await test('summarizeUsage: null input → null', () => {
  assert.equal(summarizeUsage(null), null);
  assert.equal(summarizeUsage(undefined), null);
});

await test('checkServerHealth: 200 → true', async () => {
  installFetch(() => Promise.resolve(new Response('ok', { status: 200 })));
  const ok = await checkServerHealth();
  assert.equal(ok, true);
  assert.equal(lastRequest!.url, DEFAULT_HEALTH_URL);
});

await test('checkServerHealth: fetch throws → false', async () => {
  installFetch(() => Promise.reject(new Error('ECONNREFUSED')));
  const ok = await checkServerHealth();
  assert.equal(ok, false);
});

await test('checkServerHealth: non-200 → false', async () => {
  installFetch(() => Promise.resolve(new Response('', { status: 502 })));
  const ok = await checkServerHealth();
  assert.equal(ok, false);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
