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

# Serialise runs. A push that arrives mid-run waits rather than competing for
# the VM's 8 GiB.
exec 9>"$LOCK"
if ! flock -w 3600 9; then
  write_status failed false "another gate run held the lock for an hour"
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
else
  write_status failed false "gate exited $code"
fi

exit "$code"
