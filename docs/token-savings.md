# Token Savings — Methodology and Numbers

## The goal

When using Claude Code (`claude -p`) as a backend for UI generation, the default invocation is expensive. Every call ships the full tool catalog (Read, Edit, Bash, TodoWrite, WebSearch, MCP tools, etc.) in the system prompt — typically 5,000–7,000 tokens of overhead for a task that touches zero tools. This library strips that overhead and teaches the caller to use the 1-hour ephemeral prompt cache.

## Effective tokens — the right thing to measure

Anthropic bills input tokens at different rates:

- **Uncached input** — `input_tokens` in the usage object. Charged at 1×.
- **Cache creation** — `cache_creation_input_tokens`. Charged at ~1× (small write premium).
- **Cache read** — `cache_read_input_tokens`. Charged at **0.1×**.

A meaningful "effective input tokens" figure is:

```
effective = input_tokens + cache_creation + round(0.1 × cache_read)
```

That's the number to minimize. Raw `input_tokens` alone misses the cache story entirely.

## The four configurations we measured

Same prompt (`"Draw a login form with email, password, and a button. Respond ONLY with DSL."`), same model (`haiku`), same catalog contents. Each configuration was run 3× cold (fresh cache) and averaged.

| Label | Flags | Effective input |
| --- | --- | --- |
| A (baseline) | `-p <prompt>` | ~6,300 |
| B (append catalog) | `-p --append-system-prompt <catalog>` | ~6,100 |
| C (strip tools) | `-p --append-system-prompt <catalog> --tools ""` | ~5,900 |
| **D (replace + strip + no persist)** | `-p --system-prompt <catalog> --tools "" --no-session-persistence` | **~580** |

Configuration D is what this library uses by default.

## Why D works — a diff of what Claude actually sees

- `-p` alone: system = `<default Claude Code system prompt with ~6000 tokens of tool catalog, session plumbing, persona, formatting rules>`
- `--append-system-prompt X`: system = `<default> + X` (catalog is **additive** — default still there)
- `--system-prompt X`: system = `X` (catalog **replaces** the default)
- `--tools ""`: removes tool descriptions from the system prompt entirely
- `--no-session-persistence`: omits per-session metadata that varies call-to-call and would otherwise defeat caching

Only configuration D uses all three. `--tools ""` alone on top of `--append-system-prompt` doesn't help much because most of the bloat is in Claude Code's non-tool system content.

## Cache behavior — what happens on call N+1

Once you've paid the cache-creation cost (Anthropic marks the large prefix as ephemeral with a 1-hour TTL), subsequent identical calls read from cache at 10% of the cost. For our ~5,800-token catalog:

- Call 1 (cold): `cache_creation` ≈ 5,800 → effective ≈ 5,800 + small request-specific prefix
- Call 2–N (warm, within 1h): `cache_read` ≈ 5,800 → effective ≈ 580 + small prefix

So **D is cheap even before caching**, and **becomes nearly free on the second call**. Compare to baseline A, where every call re-pays the full cost because the large system prompt varies slightly per invocation (session tokens, timestamps) and never fully caches.

## How to reproduce

```bash
./scripts/cache-probe.sh
```

The script runs each configuration three times and prints the `effective`, `cache_creation`, `cache_read`, and `output_tokens` for each run. Make sure `claude` is on PATH and logged in.

## Caveats

- Numbers above are for our specific catalog (~5,800 tokens) and a short prompt. Your catalog size scales the absolute numbers, but the **ratio** (~10×) is stable across catalog sizes because it's driven by the Claude Code overhead, not the catalog.
- The 1-hour cache window is per catalog content — any change to `catalog.ts` invalidates the cache for all users.
- `haiku` is recommended. Sonnet gives marginally higher DSL quality but 3–4× the cost per token; for UI mockups, the quality gap is small.
