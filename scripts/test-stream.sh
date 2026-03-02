#!/bin/bash
# Diagnostic script: test that claude --output-format stream-json actually streams NDJSON
# Run this OUTSIDE of a Claude session (not inside Claude Code)

set -euo pipefail

echo "=== Testing claude stream-json output ==="
echo ""

TMPDIR=$(mktemp -d)
echo "Working dir: $TMPDIR"
echo ""

echo "Spawning: claude -p 'Reply with exactly: TEST_OK' --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 1"
echo ""
echo "--- Raw output (each line should be a JSON object) ---"

EVENT_COUNT=0
RESULT_FOUND=false

claude -p "Reply with exactly: TEST_OK" \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  --max-turns 1 \
  2>/dev/null | while IFS= read -r line; do
    EVENT_COUNT=$((EVENT_COUNT + 1))
    TYPE=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type','?') + ':' + d.get('subtype',''))" 2>/dev/null || echo "PARSE_ERROR")
    echo "[$EVENT_COUNT] type=$TYPE | ${line:0:200}"

    if echo "$line" | grep -q '"type":"result"'; then
      RESULT_FOUND=true
    fi
done

echo ""
echo "--- Summary ---"
echo "Total events parsed: $EVENT_COUNT"
echo "Result event found: $RESULT_FOUND"

rm -rf "$TMPDIR"
