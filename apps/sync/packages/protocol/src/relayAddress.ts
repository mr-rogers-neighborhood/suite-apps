/**
 * Whether a relay address stays on this machine.
 *
 * Plaintext `ws://` is a local convenience: the demo relay and a relay a person runs
 * beside the app. Any address that can leave the machine needs `wss://` and a pin, so the
 * envelope verifier and both app services share this predicate rather than spelling the
 * host list three times.
 *
 * It reads a full relay URL (`ws://[::1]:8787/sync`) or one of the four host spellings on
 * its own, because a caller may have already parsed the address.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export function isLoopbackRelayUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  let host = trimmed;
  if (trimmed.includes("://")) {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      return false;
    }
  }
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}
