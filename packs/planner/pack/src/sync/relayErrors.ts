/**
 * The relay-pin sentences and refusal class, in a form a renderer can load.
 *
 * The protocol's Node module owns the original strings, but it also imports
 * `node:https` and `ws`. A pack cannot load either, so the browser build aliases
 * `@suite/sync/node` here. The class name and messages match, which is all the
 * shared lifecycle reads: it treats a pin refusal as final rather than retrying
 * a certificate that will not change.
 */
export const PIN_MISMATCH_MESSAGE =
  "The relay's certificate does not match the fingerprint pinned for this workspace. " +
  "Check the SHA-256 fingerprint the relay printed at startup and enter it again; nothing was connected.";

export const PIN_REQUIRED_MESSAGE =
  "This relay uses wss://, so its certificate fingerprint is required. " +
  "Copy the SHA-256 fingerprint line suite-sync prints at startup.";

export const PIN_MALFORMED_MESSAGE =
  "That is not a certificate fingerprint. Copy the SHA-256 fingerprint line suite-sync prints at startup.";

/** A refusal from the pin, carrying a sentence a person can act on. */
export class RelayPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayPinError";
  }
}
