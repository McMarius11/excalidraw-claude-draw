#!/usr/bin/env bash
# Measure effective input tokens across flag combinations.
# Requires: claude CLI logged in, python3, catalog at src/dsl/catalog.ts.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG=$(cat "$HERE/src/dsl/catalog.ts")
PROMPT='Canvas viewport: 1200x700 pixels. Draw a login form with email field, password field, and a button. Respond ONLY with DSL, no explanation.'

extract() {
  python3 -c "
import json, sys
d = json.load(sys.stdin)
u = d.get('usage') or {}
inp = u.get('input_tokens',0)
cc = u.get('cache_creation_input_tokens',0)
cr = u.get('cache_read_input_tokens',0)
out = u.get('output_tokens',0)
elig = inp + cc + cr
eff = inp + cc + round(cr * 0.1)
save = round(100*(elig-eff)/elig) if elig else 0
print(f'in={inp}  cache_cre={cc}  cache_read={cr}  out={out}  eff={eff}  save={save}%')
" <"$1"
}

run() {
  local label="$1"; shift
  local tmp; tmp=$(mktemp)
  local t0 t1 ms
  t0=$(date +%s%N)
  claude "$@" --output-format json --model haiku "$PROMPT" >"$tmp" 2>/dev/null
  t1=$(date +%s%N)
  ms=$(( (t1-t0)/1000000 ))
  printf "%-60s %6dms  " "$label" "$ms"
  extract "$tmp"
  rm -f "$tmp"
}

echo "=== A: Baseline (default claude -p) ==="
run "A: -p (no catalog)" -p

echo
echo "=== B: Append catalog ==="
run "B: -p --append-system-prompt CATALOG" -p --append-system-prompt "$CATALOG"

echo
echo "=== B+: Append + strip tools ==="
run "B+: B + --tools \"\"" -p --append-system-prompt "$CATALOG" --tools ""

echo
echo "=== C: Replace + strip tools + no persistence (recommended, this lib's default) ==="
run "C: -p --system-prompt CATALOG --tools \"\" --no-session-persistence" \
  -p --system-prompt "$CATALOG" --tools "" --no-session-persistence

echo
echo "=== C repeated (expect cache-read hit on 2nd and 3rd) ==="
for i in 1 2 3; do
  run "C #$i" -p --system-prompt "$CATALOG" --tools "" --no-session-persistence
done
