#!/usr/bin/env bash
# scripts/dev-sync.sh
#
# POSIX port of dev-sync.ps1 for Linux/macOS developers.
#
# Copies shared source-of-truth files into an extension target folder so
# Chrome / Edge can load the folder directly. Run it once before loading the
# unpacked extension, and again any time you edit src/lib/* while it is loaded.
#
# Why: Chromium requires every file a manifest references to live at or below
# the manifest's folder. Our shared src/lib/*.js, target adapters, and privacy
# policies live at the repo root as the single source of truth. This script
# mirrors them into extensions/<target>/. The mirrored copies are git-ignored.
#
# Usage:
#   ./scripts/dev-sync.sh            # syncs the github target (default)
#   ./scripts/dev-sync.sh github
#   ./scripts/dev-sync.sh ado
set -euo pipefail

target="${1:-github}"
case "$target" in
  github|ado) ;;
  *) echo "error: target must be 'github' or 'ado' (got '$target')" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$root/extensions/$target"
[ -d "$target_dir" ] || { echo "error: target folder does not exist: $target_dir" >&2; exit 1; }

# src/lib mirror
src_lib="$root/src/lib"
dst_lib="$target_dir/src/lib"
[ -d "$src_lib" ] || { echo "error: source folder does not exist: $src_lib" >&2; exit 1; }
rm -rf "$dst_lib"
mkdir -p "$dst_lib"
count=0
for f in "$src_lib"/*.js; do
  [ -e "$f" ] || continue
  cp -f "$f" "$dst_lib/"
  count=$((count + 1))
done
suffix=s; [ "$count" -eq 1 ] && suffix=
echo "[dev-sync] $target : $count src/lib file$suffix copied -> ./extensions/$target/src/lib"

# src/adapters mirror (only the current target's adapter, if it exists)
src_adapter="$root/src/adapters/$target.js"
if [ -f "$src_adapter" ]; then
  dst_adapters="$target_dir/src/adapters"
  rm -rf "$dst_adapters"
  mkdir -p "$dst_adapters"
  cp -f "$src_adapter" "$dst_adapters/"
  echo "[dev-sync] $target : src/adapters/$target.js copied -> ./extensions/$target/src/adapters/$target.js"
fi

# Target privacy mirror. GitHub keeps the historical PRIVACY.md source; ADO has
# a separate policy because its hosts, stored keys, and endpoints differ.
# Both ship as a top-level PRIVACY.md.
privacy_source_name=PRIVACY.md
[ "$target" = ado ] && privacy_source_name=PRIVACY_ADO.md
if [ -f "$root/$privacy_source_name" ]; then
  cp -f "$root/$privacy_source_name" "$target_dir/PRIVACY.md"
  echo "[dev-sync] $target : $privacy_source_name copied -> PRIVACY.md"
else
  echo "[dev-sync] warning: $privacy_source_name not found at repo root - extension will ship without PRIVACY.md" >&2
fi
