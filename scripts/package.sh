#!/usr/bin/env bash
# Build the release archive: the built app, its production dependencies, and the deploy files.
set -euo pipefail
tag=${1:?usage: scripts/package.sh vMAJOR.MINOR.PATCH}
name=finrod-$tag
rm -rf release && mkdir -p "release/$name"
npm run build
cp -r dist deploy package.json package-lock.json "release/$name/"
(cd "release/$name" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
tar -C release -czf "release/$name.tar.gz" "$name"
(cd release && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
echo "Built release/$name.tar.gz"
