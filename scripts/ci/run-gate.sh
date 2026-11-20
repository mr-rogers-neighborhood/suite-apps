#!/usr/bin/env bash
# Runs the whole Suite gate against one pushed commit, on the suite-dev VM.
#
# The checkout under ~/ci/checkout is only a fetch target; the gate itself
# exports the commit with `git archive` and installs from the lockfile, so a
# run never inherits node_modules, dist or stray files from an earlier run.
set -euo pipefail

sha=${1:?usage: run-gate.sh <commit>}
ROOT=${SUITE_CI_ROOT:-$HOME/ci}
CHECKOUT=$ROOT/checkout
LOG=$ROOT/logs/$sha.log
STATUS=$ROOT/status.json
LOCK=$ROOT/gate.lock

mkdir -p "$ROOT/logs" "$CHECKOUT"

write_status() {
  local state=$1 ok=$2 detail=$3
  node -e '
    const fs = require("node:fs");
    const [out, sha, state, ok, detail, log] = process.argv.slice(1);
    const status = {
      sha,
      state,
      ok: ok === "true",
      detail,
      log,
      host: require("node:os").hostname(),
      at: new Date().toISOString(),
    };
    fs.writeFileSync(out, JSON.stringify(status, null, 2) + "\n");
  ' "$STATUS" "$sha" "$state" "$ok" "$detail" "$LOG"
}

# Tell a person the result without making them ask.
#
# `~/ci/notify.env` is optional and is never read from the repository, so a
# topic or token stays on the machine:
#
#   NTFY_URL=https://ntfy.sh
#   NTFY_TOPIC=<a topic you own>
#   NTFY_TOKEN=<optional access token>
#
# A missing file, an empty topic or a broken network is not a gate failure:
# the status file is the source of truth either way.
notify() {
  local state=$1 detail=$2
  local config=$ROOT/notify.env
  [ -r "$config" ] || return 0
  # shellcheck disable=SC1090
  . "$config"
  [ -n "${NTFY_TOPIC:-}" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0

  local url=${NTFY_URL:-https://ntfy.sh}
  local title tag
  case "$state" in
    passed) title="suite-apps gate passed"; tag="white_check_mark" ;;
    *) title="suite-apps gate failed"; tag="x" ;;
  esac

  local auth=()
  if [ -n "${NTFY_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer $NTFY_TOKEN"); fi

  curl -fsS --max-time 10 "${auth[@]}" \
    -H "Title: $title" \
    -H "Tags: $tag" \
    -H "Priority: $([ "$state" = passed ] && printf default || printf high)" \
    -d "$sha · $detail · $(date -u +%Y-%m-%dT%H:%MZ)" \
    "$url/$NTFY_TOPIC" >/dev/null 2>&1 || true
}

# Serialise runs. A push that arrives mid-run waits rather than competing for
# the VM's 8 GiB.
exec 9>"$LOCK"
if ! flock -w 3600 9; then
  write_status failed false "another gate run held the lock for an hour"
  notify failed "another gate run held the lock for an hour"
  exit 1
fi

write_status running false "started"

cd "$CHECKOUT"
git fetch --prune --quiet origin
git checkout --force --quiet --detach "$sha"
git clean -xffdq

set +e
node scripts/gate.mjs --fresh
code=$?
set -e

cp -f "$CHECKOUT/.dev/gate-status.json" "$ROOT/last-gate-status.json" 2>/dev/null || true

if [ "$code" -eq 0 ]; then
  write_status passed true "passed"
  notify passed "passed"
else
  write_status failed false "gate exited $code"
  notify failed "gate exited $code"
fi

exit "$code"
