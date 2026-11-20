#!/usr/bin/env bash
# Run the checks and tests on the server, from this working tree, in ~/finrod-dev. The tests start their own Finrod
# processes on free ports with temporary data, so the running Finrod is not touched.
#   scripts/server-test.sh                         npm test: type check, build, every test
#   scripts/server-test.sh test/server.test.ts     build, then only these test files
set -euo pipefail
cd "$(dirname "$0")/.."
host=${FINROD_SERVER:-joao@minipc-linux}

rsync -az --delete --filter=':- .gitignore' --exclude .git --exclude 'PLAN-*.md' ./ "$host:finrod-dev/"
tests=$(printf '%q ' "$@")
# A changed package-lock.json reinstalls the dependencies; otherwise they stay.
ssh "$host" "export PATH=\$HOME/.local/opt/node/bin:\$PATH; cd finrod-dev &&
  { [[ \$(sha256sum < package-lock.json) == \$(cat node_modules/.lock-sha 2>/dev/null) ]] || { npm ci && sha256sum < package-lock.json > node_modules/.lock-sha; }; } &&
  export FINROD_LIVE=${FINROD_LIVE:-}; if [[ -z '$*' ]]; then npm test; else npm run build && node --test --test-force-exit $tests; fi"
