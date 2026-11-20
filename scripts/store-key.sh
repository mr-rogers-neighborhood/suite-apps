#!/usr/bin/env bash
# Make the local Suite store's signing key, once.
#
# The private half lives in ~/.gnupg and never enters the repository. What this
# writes into ~/suite-flatpak is the fingerprint and the public key:
#
#   store-key.id     the fingerprint scripts/flatpak.mjs passes to --gpg-sign
#   suite-store.gpg  the key `flatpak remote-add --gpg-import` trusts
#
# A published store needs a passphrase-protected key instead; this one is
# passphrase-less so `flatpak build-update-repo --gpg-sign` can run unattended on
# a machine that only publishes locally.
set -euo pipefail

STATE=${SUITE_STORE_STATE:-$HOME/suite-flatpak}
IDENTITY=${SUITE_STORE_IDENTITY:-"Suite Store <store@suite.run>"}
mkdir -p "$STATE"

if [ -s "$STATE/store-key.id" ] && gpg --batch --list-keys "$(cat "$STATE/store-key.id")" >/dev/null 2>&1; then
  echo "store key already present: $(cat "$STATE/store-key.id")"
else
  if ! gpg --batch --list-keys "$IDENTITY" >/dev/null 2>&1; then
    gpg --batch --passphrase '' --quick-generate-key "$IDENTITY" rsa4096 sign never
  fi
  fpr=$(gpg --with-colons --list-keys "$IDENTITY" | awk -F: '/^fpr/{print $10; exit}')
  printf '%s\n' "$fpr" >"$STATE/store-key.id"
  gpg --export "$fpr" >"$STATE/suite-store.gpg"
  echo "created store key $fpr"
fi

chmod 600 "$STATE/store-key.id" 2>/dev/null || true
gpg --list-keys --with-fingerprint "$(cat "$STATE/store-key.id")" | sed -n '1,4p'
