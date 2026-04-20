# What We Tried — Negative Findings

Several flags and strategies looked promising but were rejected based on measurement. Documenting them so you don't have to rediscover.

## `--max-turns 1`

**Hypothesis:** Capping turns forces a single synchronous response, saving time and tokens.

**Observation:** Claude produced **4× more output tokens** and ran 2× slower. It appeared to treat the constraint as a prompt to explain what it *would have* done, pre-emptively packaging reasoning into the single turn.

**Verdict:** Reject. This flag is useful for agentic loops where you want to cap iterations, not for single-shot generation.

## `--effort low`

**Hypothesis:** Lower reasoning effort trades quality for speed and tokens.

**Observation:** In a 3×3 A/B probe with compile validation, **1 of 3 runs** produced DSL that failed to parse (`unexpected char "%"` — Claude emitted Markdown-ish output instead of DSL). That's a 33% silent-failure rate at a production boundary where parse failures surface as user-visible errors with no recovery path.

**Verdict:** Reject. The speed win doesn't outweigh unpredictability.

## `--effort medium`

**Hypothesis:** Medium effort should be a sweet spot — more careful than low, cheaper than default.

**Observation:** Slower and more verbose than default, with no measurable DSL quality improvement on our prompts.

**Verdict:** Reject. No reason to pay more for the same output.

## `--bare`

**Hypothesis:** `--bare` strips everything Claude Code adds, giving us a raw model call.

**Observation:** `--bare` requires API-key auth (`ANTHROPIC_API_KEY`). Our goal was subscription-auth via `claude login`; `--bare` breaks that.

**Verdict:** Reject for subscription use. If you have API-key auth, `--bare` may be worth re-evaluating.

## `--exclude-dynamic-system-prompt-sections`

**Hypothesis:** This removes dynamic sections (MCP server descriptions, user rules) that vary and defeat caching.

**Observation:** With `--system-prompt` (replace), there's no default system prompt to trim — the flag is a no-op.

**Verdict:** Redundant with Config C. Safe to leave off.

## Raw API via `@anthropic-ai/sdk`

**Hypothesis:** Skip `claude -p` entirely, use the TypeScript SDK directly.

**Observation:** Works, but requires `ANTHROPIC_API_KEY`. The whole point of using Claude Code is to let end users leverage their existing Claude subscription instead of provisioning API billing.

**Verdict:** Reject for this project's goal.

## Prompt compaction (gzip + base64 system prompt)

**Hypothesis:** Compress the catalog to reduce tokens.

**Observation:** Claude treats the decoded bytes as text; base64/gzip inflates tokens by 1.3–2×. Cute idea, doesn't work.

**Verdict:** Reject.

## Streaming responses

**Hypothesis:** Start rendering partial DSL while Claude is still generating.

**Observation:** DSL parses are tree-structured — partial DSL is almost always invalid until the outer `col { ... }` closes. Streaming would either require speculative rendering with re-render churn, or gain nothing.

**Verdict:** Reject for DSL. Would work for plain-text outputs.
