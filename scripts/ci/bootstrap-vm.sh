#!/usr/bin/env bash
# Prepares the suite-dev VM to be the independent gate, then prints the remote
# to push to. Run this from the host; it is idempotent.
#
#   scripts/ci/bootstrap-vm.sh
#   git push vm main
#
# What it creates on the VM, all under the `aurora` user:
#
#   ~/git/suite-apps.git   the bare canonical repository
#   ~/ci/checkout          a clone the gate fetches into
#   ~/ci/run-gate.sh       the runner (copied from this repo)
#   ~/ci/status.json       the last result, also readable from the host:
#                          ssh suite-dev cat ~/ci/status.json
#   ~/ci/logs/<sha>.log    one log per commit
#   ~/ci/last-gate-status.json  the gate's own JSON for the last run
#
# The VM needs: node >= 22, pnpm 12.17, docker (Canvas's secret scan runs
# gitleaks in a container), xorg-x11-server-Xvfb and Electron's GTK libraries
# (for the e2e phase), passwordless sudo, and swap. See the README.
set -euo pipefail

HOST=${SUITE_CI_HOST:-suite-dev}
HERE=$(cd "$(dirname "$0")" && pwd)

echo "bootstrapping $HOST"

# Paths expand on the VM, so a different $HOME there still works.
ROOT=$(ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
ROOT=${SUITE_CI_ROOT:-$HOME/ci}
BARE=${SUITE_CI_BARE:-$HOME/git/suite-apps.git}
mkdir -p "$(dirname "$BARE")" "$ROOT/logs"
if [ ! -d "$BARE" ]; then git init --bare --initial-branch=main "$BARE" >/dev/null; fi
if [ ! -d "$ROOT/checkout/.git" ]; then git clone -q "$BARE" "$ROOT/checkout" 2>/dev/null; fi
printf '%s\n' "$ROOT"
REMOTE
)

BARE=$(ssh "$HOST" 'printf "%s\n" "${SUITE_CI_BARE:-$HOME/git/suite-apps.git}"')

scp -q "$HERE/run-gate.sh" "$HOST:/tmp/suite-run-gate.sh"
scp -q "$HERE/post-receive" "$HOST:/tmp/suite-post-receive"
ssh "$HOST" "install -m 755 /tmp/suite-run-gate.sh '$ROOT/run-gate.sh'
  install -m 755 /tmp/suite-post-receive '$BARE/hooks/post-receive'
  rm -f /tmp/suite-run-gate.sh /tmp/suite-post-receive
  node -v; pnpm -v; df -h / | tail -1
  if ! systemctl is-active --quiet docker || [ ! -S /var/run/docker.sock ]; then
    echo 'warning: docker is not running; the secret scan needs it'
  fi"

if git remote get-url vm >/dev/null 2>&1; then
  git remote set-url vm "$HOST:$BARE"
else
  git remote add vm "$HOST:$BARE"
fi

echo
echo "remote vm -> $(git remote get-url vm)"
echo "push:  git push vm main"
echo "watch: ssh $HOST 'tail -f $ROOT/logs/<sha>.log'"
echo "state: ssh $HOST 'cat $ROOT/status.json'"
