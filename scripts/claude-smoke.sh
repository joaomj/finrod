#!/usr/bin/env bash
# Start the built Finrod server on the Claude Code login and ask it one question. Run npm run build first.
set -euo pipefail
cd "$(dirname "$0")/.."
pinned=$(<claude-code-version)
tested=$("${CLAUDE_DIRECTSDK_COMMAND:-claude}" --version | cut -d' ' -f1)
[[ $tested == "$pinned" ]] || echo "Testing Claude Code $tested; claude-code-version names $pinned. Write $tested there if this test passes." >&2
dir=$(mktemp -d)
token=$(openssl rand -hex 32)
port=18787
printf 'correct horse battery staple\n' > "$dir/memory-key"
FINROD_PROVIDER=claude-directsdk FINROD_MODEL="${FINROD_MODEL:-haiku}" FINROD_PORT=$port FINROD_DATA_DIR="$dir" \
  FINROD_GATEWAY_TOKEN=$token FINROD_MEMORY_KEY_FILE="$dir/memory-key" \
  node dist/server/main.js > "$dir/server.log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true; echo "--- server log"; cat "$dir/server.log"; rm -rf "$dir"' EXIT
for _ in $(seq 60); do grep -q "Finrod listening" "$dir/server.log" && break; kill -0 $pid || exit 1; sleep 1; done
api() { curl -sS -H "Authorization: Bearer $token" -H 'content-type: application/json' "$@"; }
id=$(api "http://127.0.0.1:$port/api/stream" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
api -X POST "http://127.0.0.1:$port/api/conversations/$id/messages" -d '{"text":"Que dia e hoje? Responda em uma frase.","requestId":"smoke-0001"}'
echo
for _ in $(seq 90); do
  answers=$(api "http://127.0.0.1:$port/api/gateway/answers")
  if node -e 'const a=JSON.parse(process.argv[1]).answers; process.exit(a.length?0:1)' "$answers"; then echo "$answers"; exit 0; fi
  sleep 2
done
echo "No answer in 180 s"; exit 1
