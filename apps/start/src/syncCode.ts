import { formatRelayLink, qrMatrix } from "@suite/sync";
import type { SyncQr } from "./shared.js";

/**
 * The relay code Start shows, in the same shape the console puts on its page.
 *
 * The address and certificate are the whole story before an invitation exists: a
 * phone that scans this can meet the relay and pin it. An invitation is added by
 * the console, which is the process that holds the live ones.
 */
export function relayCode(address: string | null, fingerprint: string | null): SyncQr | null {
  if (address === null) return null;
  try {
    const payload = formatRelayLink({
      url: address,
      fingerprint,
      workspaceId: null,
      inviteId: null,
    });
    const matrix = qrMatrix(payload);
    return { payload, size: matrix.size, rows: matrix.rows };
  } catch {
    // A relay address the link format cannot carry means no code, not a broken pane.
    return null;
  }
}
