#!/usr/bin/env bash
# Copies the Better form renderer's runtime files out of node_modules into the
# served tree, where src/better-renderer/view.ts loads them as a plain script.
# Usage: better-renderer-assets.sh [target dir]   (default: public/better-renderer)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
src=node_modules/@better/form-renderer
target=${1:-public/better-renderer}
[ -d "$src" ] || { echo "$src is not installed (private registry; see src/better-renderer/README.md)" >&2; exit 1; }
rm -rf "$target"
mkdir -p "$target"
cp -R "$src"/. "$target"/
rm -rf "$target/node_modules"
echo "copied $src -> $target ($(du -sh "$target" | cut -f1))"
