import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { callClaude, ClaudeShimError } from './shim.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SCENE_SERVER_PORT ?? 5174);
const CATALOG_PATH = process.env.SCENE_CATALOG_PATH ?? resolve(__dirname, '../dsl/catalog.ts');
const DEFAULT_MODEL = process.env.SCENE_CLAUDE_MODEL ?? 'haiku';
const CLAUDE_BIN = process.env.SCENE_CLAUDE_BIN ?? 'claude';
const TIMEOUT_MS = Number(process.env.SCENE_CLAUDE_TIMEOUT_MS ?? 120_000);

const catalog = await readFile(CATALOG_PATH, 'utf8');

const MAX_BODY_BYTES = 256 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super('payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return rejectBody(new PayloadTooLargeError());
    }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        return rejectBody(new PayloadTooLargeError());
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, model: DEFAULT_MODEL });
  }

  if (req.method === 'POST' && req.url === '/api/scene') {
    let body: { userMessage?: string; currentSceneDsl?: string; model?: string; canvasWidth?: number; canvasHeight?: number };
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        return json(res, 413, { error: { kind: 'bad_request', message: 'request body too large' } });
      }
      return json(res, 400, { error: { kind: 'bad_request', message: 'invalid JSON' } });
    }
    if (!body || typeof body.userMessage !== 'string' || body.userMessage.trim().length === 0) {
      return json(res, 400, { error: { kind: 'bad_request', message: 'userMessage required' } });
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const startedAt = Date.now();
    try {
      const result = await callClaude({
        userMessage: body.userMessage,
        systemPrompt: catalog,
        currentSceneDsl: body.currentSceneDsl,
        model: body.model ?? DEFAULT_MODEL,
        canvasWidth: body.canvasWidth,
        canvasHeight: body.canvasHeight,
        signal: controller.signal,
        claudeBin: CLAUDE_BIN,
        timeoutMs: TIMEOUT_MS,
      });
      console.log(`[scene] ${body.userMessage.slice(0, 60)}… (${Date.now() - startedAt}ms)`);
      return json(res, 200, {
        dsl: result.result,
        usage: result.usage ?? null,
        durationMs: result.duration_ms ?? Date.now() - startedAt,
      });
    } catch (e) {
      if (e instanceof ClaudeShimError && e.aborted) {
        console.log(`[scene] client aborted after ${Date.now() - startedAt}ms`);
        return;
      }
      const kind = e instanceof ClaudeShimError && e.timeout ? 'claude_timeout' : 'claude_failed';
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[scene:${kind}]`, msg);
      if (res.writableEnded) return;
      return json(res, 502, { error: { kind, message: msg } });
    }
  }

  json(res, 404, { error: { kind: 'not_found' } });
});

server.listen(PORT, () => {
  console.log(`[scene-server] http://localhost:${PORT} — model=${DEFAULT_MODEL}`);
});
