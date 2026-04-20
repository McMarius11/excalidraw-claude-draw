# excalidraw-claude-draw

Generate [Excalidraw](https://excalidraw.com) scenes from natural-language prompts using the [Claude Code](https://claude.com/claude-code) CLI — measured **~10× token savings** vs. a naive `claude -p` invocation, with a compact DSL that's both cheap to generate and deterministic to render.

No Anthropic API key required — uses your existing Claude Code subscription via `claude -p` as a subprocess.

## What this is

Three pieces that work together:

1. **A compact DSL** for UI mockups (`rect`, `row`, `col`, `txt`, …) that's far more token-efficient than describing Excalidraw JSON directly.
2. **A parser + compiler** that turns DSL source into Excalidraw element arrays — extensible via `extraHandlers` so you can register your own components (charts, custom cards, domain-specific primitives).
3. **A measured set of `claude -p` flags** (the "Config C" combo) that eliminates Claude Code's built-in tool prompt and session plumbing for single-shot generation — cutting effective input tokens by ~10× on the first call and enabling prompt caching on follow-ups.

## Measured savings

Same prompt, same model (`haiku`), same catalog. Probe runs a single DSL generation end-to-end and records `input_tokens + cache_creation + 0.1 * cache_read` (the effective billable input).

| Configuration | Flags | Effective input tokens | Reduction |
| --- | --- | --- | --- |
| A (baseline) | `claude -p` | ~6,300 | baseline |
| B | `-p --append-system-prompt <catalog>` | ~6,100 | 3% |
| **C (this library's default)** | **`-p --system-prompt <catalog> --tools "" --no-session-persistence`** | **~580** | **~91%** |

On cached follow-up calls (same system prompt within the 1-hour ephemeral-cache window), the input drops further to the hundreds of tokens — the system prompt costs 10% of its tokenized length.

See [docs/token-savings.md](docs/token-savings.md) for the full methodology and [scripts/cache-probe.sh](scripts/cache-probe.sh) to reproduce.

## Why Config C works

Out of the box `claude -p`:

- Injects the full Claude Code tool catalog (Read, Edit, Bash, TodoWrite, etc.) into the system prompt — thousands of tokens for a task that touches no tools.
- Appends session-persistence plumbing and dynamic system-prompt sections.
- Treats `--append-system-prompt` as additive — your catalog is added on top of all the above.

Config C strips all three:

- `--system-prompt "<your catalog>"` **replaces** the default system prompt instead of appending.
- `--tools ""` tells the CLI there are no tools available — nothing to describe.
- `--no-session-persistence` avoids per-session metadata that would otherwise cache-bust.

The result is a minimal prompt where **your catalog is the entire system message**, which then caches cleanly across calls.

## Install

```bash
git clone https://github.com/mcmarius11/excalidraw-claude-draw
cd excalidraw-claude-draw
# no dependencies to install — source-first, runs via Node strip-types
node --version  # need >= 22.6 for --experimental-strip-types
which claude    # Claude Code CLI must be on PATH and logged in
```

## Quick start — server + browser

```bash
npm run server
# [scene-server] http://localhost:5174 — model=haiku
```

From the browser (or any HTTP client):

```js
import { generateScene } from './src/index.ts';

const { elements, dsl, usage } = await generateScene({
  userMessage: 'Draw a login form with email, password, submit button',
  canvasWidth: 1200,
  canvasHeight: 700,
});

// `elements` is an Excalidraw element array — feed it directly to <Excalidraw />
// `dsl` is the raw DSL Claude produced (good for diffing / follow-up edits)
// `usage` includes effective tokens and cache-savings percentage
```

## Quick start — library only (no server)

If you want to call Claude yourself and only use the parser/compiler:

```ts
import { compileFromSource, COMPONENT_CATALOG, callClaude } from './src/index.ts';

const { result: dsl } = await callClaude({
  userMessage: 'Draw a 3-column pricing table',
  systemPrompt: COMPONENT_CATALOG,
  canvasWidth: 1200,
  canvasHeight: 700,
});

const elements = compileFromSource(dsl, {}, { x: 0, y: 0, w: 1200, h: 700 });
```

## Extending the DSL

Register custom components via `extraHandlers`:

```ts
import { compileFromSource, type Handler } from './src/index.ts';

const badge: Handler = (node, box, _ctx, els) => {
  // node.attrs is typed as Record<string, DslValue>
  // box is the layout-computed { x, y, w, h }
  // els is the output array — push Excalidraw element objects here
  els.push({
    type: 'rectangle',
    x: box.x, y: box.y, width: box.w, height: 20,
    backgroundColor: '#3b82f6',
    /* ... */
  });
};

const elements = compileFromSource(
  'row gap=8 { badge label="NEW"  badge label="HOT" }',
  { extraHandlers: { badge } },
);
```

Your handler sees the same merged registry as the builtins, so layout containers (`row`, `col`, `stack`) will auto-place custom components correctly.

## Test

```bash
npm test
# runs parser, compiler, and client suites — all hermetic, no network
```

## Repo layout

```
src/
  dsl/
    parser.ts        # DSL source → AST
    compiler.ts      # AST → Excalidraw elements (with extraHandlers extension point)
    layout.ts        # flex-split and padding math
    primitives.ts    # Excalidraw element factories
    catalog.ts       # the system prompt shipped to Claude
    client.ts        # browser-side fetch + compile wrapper
    types.ts         # DslNode, DslValue, DslParseError
  server/
    shim.ts          # generic `callClaude()` with Config C flags, timeout, retry, abort
    index.ts         # HTTP server wrapping the shim
  index.ts           # barrel re-exports
test/
  parser.test.ts
  compiler.test.ts
  client.test.ts
scripts/
  cache-probe.sh     # token-savings measurement tool
docs/
  token-savings.md
  what-we-tried.md   # negative findings (--max-turns 1, --effort low/medium, --bare, ...)
```

## What we tried that didn't work

Measured and rejected — see [docs/what-we-tried.md](docs/what-we-tried.md) for data:

- `--max-turns 1` — 4× **more** output tokens, 2× slower (Claude treats it as a constraint to explain around).
- `--effort low` — 33% silent DSL-compile-failure rate.
- `--effort medium` — slower and more verbose with no quality gain.
- `--bare` — forces API-key auth (our goal was subscription-only).
- `--exclude-dynamic-system-prompt-sections` — no-op when `--system-prompt` already replaces the default.

## Acknowledgements

- **[Claude Code](https://claude.com/claude-code)** (Anthropic) — the CLI this library drives as a subprocess. Proprietary; usage requires your own Claude subscription or API key. See Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and [Commercial Terms](https://www.anthropic.com/legal/commercial-terms).
- **[Excalidraw](https://github.com/excalidraw/excalidraw)** — MIT-licensed. We produce data in Excalidraw's element JSON format but do not import or redistribute their code; Excalidraw itself is not a dependency of this library.

## License

MIT — see [LICENSE](LICENSE).
