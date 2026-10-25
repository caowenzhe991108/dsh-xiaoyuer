#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${1:-web}"
dsh_cli="${DSH_CLI:-dsh}"

command -v "$dsh_cli" >/dev/null 2>&1 || {
  echo "dsh not found; set DSH_CLI to the dsh executable" >&2
  exit 1
}

"$dsh_cli" plugin --profile "$profile" add "link:$root/plugins/dsh-xiaoyuer"
echo "Installed @local/dsh-xiaoyuer into profile '$profile'. Restart DSH if it does not appear."
