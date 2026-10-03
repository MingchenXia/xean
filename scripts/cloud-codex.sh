#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cloud_dir=${XEAN_CLOUD_DIR:-$root/.xean/cloud}
codex_command=${XEAN_CODEX_COMMAND:-codex}
if ! command -v "$codex_command" >/dev/null; then
  printf 'Native Codex CLI is missing. Use the platform CLI or install the official CLI before model work.\n' >&2
  exit 127
fi
# Auth is inherited from the current account; never copy it into cloud_dir.
auth_dir=${CODEX_HOME:-${HOME:?}/.codex}
if [[ "${1:-}" == exec || ( "${1:-}" == login && "${2:-}" != status ) ]]; then
  if [[ -d "$auth_dir" ]] && ! test -w "$auth_dir"; then
    printf 'Codex initialization needs its native directory writable. Use exec_command sandbox_permissions=require_escalated for this exact invocation; retain the child workspace-write/read-only sandbox. Do not move or copy authentication.\n' >&2
    exit 73
  fi
fi
mkdir -p "$cloud_dir/state" "$cloud_dir/log"
encoder=$(command -v bun || command -v node)
encode_path() {
  "$encoder" --eval 'console.log(JSON.stringify(process.argv.at(-1)))' "$1"
}
exec "$codex_command" \
  -c "sqlite_home=$(encode_path "$cloud_dir/state")" \
  -c "log_dir=$(encode_path "$cloud_dir/log")" \
  "$@"
