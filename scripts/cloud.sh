#!/usr/bin/env bash
set -euo pipefail

# Bootstrap before Bun is available; application execution stays on locked Bun.
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cloud_dir=${XEAN_CLOUD_DIR:-$root/.xean/cloud}
bun=$cloud_dir/bun/bin/bun
tini=$cloud_dir/bin/tini
action=${1:-setup}
if (( $# )); then shift; fi
case "$action" in
  setup|doctor|login|check|xean) ;;
  *) printf 'Usage: bash scripts/cloud.sh [setup|doctor|login|check|xean [CLI arguments]]\n' >&2; exit 2 ;;
esac
if [[ "$action" != xean && $# != 0 ]]; then
  printf 'Only xean accepts additional arguments.\n' >&2
  exit 2
fi
if [[ "$(uname -s)/$(uname -m)" != Linux/x86_64 ]]; then
  printf 'Cloud bootstrap supports Linux x86_64. Use README portable Bun setup on other platforms.\n' >&2
  exit 1
fi
for tool in node npm curl tar; do command -v "$tool" >/dev/null; done
mkdir -p "$cloud_dir/cache" "$cloud_dir/bin" "$cloud_dir/bun"
export NPM_CONFIG_CACHE="$cloud_dir/cache/npm"
export BUN_INSTALL_CACHE_DIR="$cloud_dir/cache/bun-install"
export XDG_CACHE_HOME="$cloud_dir/cache"

if [[ ! -x "$bun" || "$action" == setup ]]; then
  archive=$cloud_dir/cache/oven-bun-linux-x64-1.4.2.tgz
  if [[ ! -f "$archive" ]]; then
    npm pack @oven/bun-linux-x64@1.4.2 --ignore-scripts --pack-destination "$cloud_dir/cache" --json >&2
  fi
  node --input-type=module - "$archive" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const expected = '9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng==';
if (createHash('sha512').update(readFileSync(process.argv[2])).digest('base64') !== expected)
  throw new Error('Bun 1.4.2 archive integrity mismatch; remove the corrupt cache entry and rerun setup.');
JS
  tar -xzf "$archive" --strip-components=1 -C "$cloud_dir/bun"
fi
if [[ ! -x "$tini" || "$action" == setup ]]; then
  archive=$cloud_dir/cache/tini-amd64
  if [[ ! -f "$archive" ]]; then
    staged=$(mktemp "$cloud_dir/cache/tini.XXXXXX")
    trap 'rm -f "$staged"' EXIT
    curl --fail --silent --show-error --location --output "$staged" https://github.com/krallin/tini/releases/download/v0.19.0/tini-amd64
    mv "$staged" "$archive"
    trap - EXIT
  fi
  # SHA-256 from the upstream v0.19.0 checksum, not from downloaded bytes.
  printf '%s  %s\n' 93dcc18adc78c65a028a84799ecf8ad40c936fdfc5f2a57b1acda5a8117fa82c "$archive" | sha256sum -c - >&2
  install -m 0755 "$archive" "$tini"
fi
export PATH="$cloud_dir/bin:$cloud_dir/bun/bin:$PATH"
test "$("$bun" --version)" = 1.4.2
cd "$root"
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const provenance = JSON.parse(readFileSync('vendor/pi/provenance.json', 'utf8'));
for (const entry of [...provenance.artifacts, ...provenance.patches]) {
  const bytes = readFileSync(entry.path);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256 ||
      (entry.bytes !== undefined && bytes.length !== entry.bytes))
    throw new Error(`Dependency provenance mismatch: ${entry.path}`);
}
JS
if ! "$bun" --no-install --no-env-file --eval 'import { verifyInstall } from "./scripts/dependencies.ts"; await verifyInstall(process.cwd());' >/dev/null 2>&1; then
  "$tini" -s -g -- "$bun" run setup >&2
fi
# This file is generated, contains no auth, and follows the current checkout path.
"$bun" --no-install --no-env-file scripts/cloud-settings.ts "$cloud_dir/codex-settings.json"
case "$action" in
  setup) "$tini" -s -g -- "$bun" run xean --version ;;
  check) exec "$tini" -s -g -- "$bun" run check ;;
  xean) exec "$tini" -s -g -- "$bun" --no-install --no-env-file packages/cli/src/index.ts "$@" ;;
  login) exec "$tini" -s -g -- "$root/scripts/cloud-codex.sh" login --device-auth ;;
  doctor)
    "$tini" --version
    "$tini" -s -g -- "$bun" run xean --version
    "$tini" -s -g -- "$root/scripts/cloud-codex.sh" login status
    printf 'Local login is not proof of service authorization. Check a completed turn for actual model access.\n'
    ;;
esac
