import { spawn } from 'node:child_process';

export interface CallClaudeOptions {
  userMessage: string;
  systemPrompt: string;
  currentSceneDsl?: string;
  model?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  signal?: AbortSignal;
  claudeBin?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ClaudeResult {
  result: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  duration_ms?: number;
}

export class ClaudeShimError extends Error {
  retryable: boolean;
  aborted: boolean;
  timeout: boolean;
  constructor(message: string, flags: { retryable?: boolean; aborted?: boolean; timeout?: boolean } = {}) {
    super(message);
    this.name = 'ClaudeShimError';
    this.retryable = !!flags.retryable;
    this.aborted = !!flags.aborted;
    this.timeout = !!flags.timeout;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_MODEL = 'haiku';
const DEFAULT_BIN = 'claude';

function buildPrompt(opts: CallClaudeOptions): string {
  const w =
    Number.isFinite(opts.canvasWidth) && (opts.canvasWidth as number) >= 200
      ? Math.round(opts.canvasWidth as number)
      : 1540;
  const h =
    Number.isFinite(opts.canvasHeight) && (opts.canvasHeight as number) >= 200
      ? Math.round(opts.canvasHeight as number)
      : 900;
  const parts: string[] = [];
  parts.push(
    `Canvas viewport: ${w}x${h} pixels. Use exactly these dimensions as the root box (col x=0 y=0 w=${w} h=${h} ...) and lay out everything inside — fill the available area, do not leave large empty space on the right/bottom.`
  );
  if (opts.currentSceneDsl && opts.currentSceneDsl.trim().length > 0) {
    parts.push(`Current scene DSL:\n${opts.currentSceneDsl}\n\nRequested change:`);
  }
  parts.push(opts.userMessage);
  return parts.join('\n\n');
}

function callOnce(opts: CallClaudeOptions): Promise<ClaudeResult> {
  return new Promise((resolveCall, rejectCall) => {
    if (opts.signal?.aborted) return rejectCall(new ClaudeShimError('aborted', { aborted: true }));

    const prompt = buildPrompt(opts);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const bin = opts.claudeBin ?? DEFAULT_BIN;

    // Config C: --system-prompt (replace) + --tools "" + --no-session-persistence
    // Measured ~10x input-token reduction vs. default invocation.
    const args = [
      '-p',
      '--system-prompt', opts.systemPrompt,
      '--tools', '',
      '--no-session-persistence',
      '--output-format', 'json',
      '--model', opts.model || DEFAULT_MODEL,
      prompt,
    ];

    const child = spawn(bin, args, { signal: opts.signal });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const kill = (sig: NodeJS.Signals) => {
      if (!child.killed) {
        try { child.kill(sig); } catch { /* ignore */ }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 2000);
    }, timeoutMs);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (e: NodeJS.ErrnoException) => {
      settle(() => {
        if (e.name === 'AbortError' || opts.signal?.aborted) {
          return rejectCall(new ClaudeShimError('aborted', { aborted: true }));
        }
        rejectCall(new ClaudeShimError(`spawn failed: ${e.message}`));
      });
    });
    child.on('close', (code) => {
      settle(() => {
        if (opts.signal?.aborted) return rejectCall(new ClaudeShimError('aborted', { aborted: true }));
        if (timedOut) return rejectCall(new ClaudeShimError(`claude timed out after ${timeoutMs}ms`, { timeout: true }));
        if (code !== 0) {
          return rejectCall(
            new ClaudeShimError(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`, { retryable: true })
          );
        }
        try {
          const parsed = JSON.parse(stdout) as {
            is_error?: boolean;
            type?: string;
            subtype?: string;
            result?: string;
            usage?: ClaudeResult['usage'];
            duration_ms?: number;
          };
          if (parsed.is_error || parsed.type !== 'result' || parsed.subtype !== 'success') {
            return rejectCall(
              new ClaudeShimError(parsed.result || stderr || `claude returned ${parsed.subtype}`, { retryable: true })
            );
          }
          resolveCall({
            result: parsed.result ?? '',
            usage: parsed.usage ?? null,
            duration_ms: parsed.duration_ms,
          });
        } catch (e) {
          rejectCall(
            new ClaudeShimError(
              `claude JSON parse failed: ${(e as Error).message} — first chars: ${stdout.slice(0, 200)}`,
              { retryable: true }
            )
          );
        }
      });
    });
  });
}

export async function callClaude(opts: CallClaudeOptions): Promise<ClaudeResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callOnce(opts);
    } catch (e) {
      lastErr = e;
      if (e instanceof ClaudeShimError) {
        if (e.aborted || e.timeout || !e.retryable || attempt === maxAttempts) throw e;
        console.warn(`[claude] attempt ${attempt} failed, retrying: ${e.message.slice(0, 120)}`);
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}
