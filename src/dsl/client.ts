import { compileFromSource, type CompileOptions } from './compiler.ts';
import { DslParseError } from './types.ts';

export const DEFAULT_API_URL = '/api/scene';
export const DEFAULT_HEALTH_URL = '/api/health';

export type SceneClientErrorKind =
  | 'server_unreachable'
  | 'server_error'
  | 'claude_failed'
  | 'claude_timeout'
  | 'bad_request'
  | 'empty'
  | 'parse'
  | 'compile';

export class SceneClientError extends Error {
  kind: SceneClientErrorKind;
  status?: number;
  details?: string;
  constructor(kind: SceneClientErrorKind, message: string, status?: number, details?: string) {
    super(message);
    this.name = 'SceneClientError';
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedRead: number;
  cacheCreated: number;
  effectiveInputTokens: number;
  savingsPct: number;
}

export interface GenerateSceneOptions {
  userMessage: string;
  currentSceneDsl?: string;
  model?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  signal?: AbortSignal;
  apiUrl?: string;
  compile?: CompileOptions;
}

export interface GenerateSceneResult {
  elements: unknown[];
  dsl: string;
  usage: UsageSummary | null;
  durationMs?: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function summarizeUsage(u: RawUsage | null | undefined): UsageSummary | null {
  if (!u) return null;
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cachedRead = u.cache_read_input_tokens ?? 0;
  const cacheCreated = u.cache_creation_input_tokens ?? 0;
  const totalEligible = inputTokens + cachedRead + cacheCreated;
  const effectiveInputTokens = inputTokens + cacheCreated + Math.round(cachedRead * 0.1);
  const savingsPct =
    totalEligible > 0
      ? Math.round(((totalEligible - effectiveInputTokens) / totalEligible) * 100)
      : 0;
  return { inputTokens, outputTokens, cachedRead, cacheCreated, effectiveInputTokens, savingsPct };
}

export async function generateScene(opts: GenerateSceneOptions): Promise<GenerateSceneResult> {
  if (!opts.userMessage.trim()) {
    throw new SceneClientError('empty', 'prompt is empty');
  }

  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userMessage: opts.userMessage,
        currentSceneDsl: opts.currentSceneDsl,
        model: opts.model,
        canvasWidth: opts.canvasWidth,
        canvasHeight: opts.canvasHeight,
      }),
    });
  } catch (e) {
    throw new SceneClientError(
      'server_unreachable',
      'scene server unreachable',
      undefined,
      e instanceof Error ? e.message : String(e)
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { kind?: string; message?: string } };
    const kindRaw = body?.error?.kind;
    const kind: SceneClientErrorKind =
      kindRaw === 'claude_failed'
        ? 'claude_failed'
        : kindRaw === 'claude_timeout'
          ? 'claude_timeout'
          : kindRaw === 'bad_request'
            ? 'bad_request'
            : 'server_error';
    const msg = body?.error?.message ?? `server error (${res.status})`;
    throw new SceneClientError(kind, msg, res.status);
  }

  const json = (await res.json()) as { dsl?: string; usage?: RawUsage; durationMs?: number };
  const dsl = json.dsl;
  if (typeof dsl !== 'string' || dsl.trim().length === 0) {
    throw new SceneClientError('parse', 'server returned no DSL');
  }

  let elements: unknown[];
  const rootBox =
    opts.canvasWidth && opts.canvasHeight && opts.canvasWidth > 0 && opts.canvasHeight > 0
      ? { x: 0, y: 0, w: Math.round(opts.canvasWidth), h: Math.round(opts.canvasHeight) }
      : undefined;
  try {
    elements = compileFromSource(dsl, opts.compile ?? {}, rootBox);
  } catch (e) {
    const details =
      e instanceof DslParseError
        ? `DSL parse at [${e.line}:${e.col}]: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    throw new SceneClientError('compile', 'DSL could not be compiled', undefined, details);
  }

  return { elements, dsl, usage: summarizeUsage(json.usage), durationMs: json.durationMs };
}

export async function checkServerHealth(url: string = DEFAULT_HEALTH_URL, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal });
    return res.ok;
  } catch {
    return false;
  }
}
