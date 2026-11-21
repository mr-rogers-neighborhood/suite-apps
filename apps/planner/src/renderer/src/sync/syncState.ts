import type { SyncInfo, SyncState } from "@suite/planner-core";
import type { SyncSituation } from "@suite/ui";

/**
 * What the sync control says, decided without a renderer so every state can be read as a
 * test case.
 *
 * The vocabulary is deliberately small, because a person has only four questions about a
 * shared workspace: is my work safe, is anyone else in it, is the relay answering, and have
 * I been let in yet. The protocol's words — frame, epoch, key package — never appear. They
 * are how it works, not what anyone is being asked to do.
 */
export function syncSituation(state: SyncState): SyncSituation {
  switch (state.state) {
    case "off":
      return "local";
    case "connecting":
      return "connecting";
    case "syncing":
      return "syncing";
    case "asleep":
      return "asleep";
    case "refused":
      return "refused";
    case "waiting":
      return "waiting";
    case "removed":
      return "removed";
  }
}

export function syncLabel(state: SyncState): string {
  switch (state.state) {
    case "off":
      return "Local only";
    case "connecting":
      return "Connecting";
    case "syncing":
      return "Syncing";
    case "asleep":
      return "Relay asleep";
    case "refused":
      return "Not syncing";
    case "waiting":
      return "Waiting";
    case "removed":
      return "Removed";
  }
}

/**
 * Why sync is where it is, in words that name the next thing a person would do.
 *
 * The relay refuses with a small set of codes. Those are for us; someone reading this needs
 * to know whether to ask for another invitation, wait, or do nothing because their work is
 * already saved here.
 */
export function syncSentence(state: SyncState): string {
  switch (state.state) {
    case "off":
      return "This workspace is one file on this machine. Sharing it is optional.";
    case "connecting":
      return "Asking the relay at the address you gave.";
    case "syncing":
      return "Edits travel to the other devices through the relay, which cannot read them.";
    case "asleep":
      return "The relay is not answering. Your work is saved here, and this device will try again.";
    case "refused":
      return refusalSentence(state.reason);
    case "waiting":
      return "This device has asked to join. Keep Planner open on the other machine until it is let in.";
    case "removed":
      return "An owner of this workspace removed this device. Ask for a new invitation.";
  }
}

function refusalSentence(reason: string): string {
  switch (reason) {
    case "invite-expired":
    case "expired":
    case "invite-spent":
    case "unknown-invite":
      return "That invitation cannot be used. Ask for a new one.";
    case "not-authorized":
    case "not-owner":
      return "This device is not allowed to change this workspace.";
    case "stale-epoch":
    case "wrong-seq":
      return "This device is behind the others. It will catch up when it reconnects.";
    case "wrong-workspace":
      return "That invitation is for a different workspace.";
    default:
      // A join refusal is already a sentence written for the person holding the link;
      // anything else is a protocol code and belongs behind a plain answer.
      return reason.includes(" ") && reason.length > 24
        ? reason
        : "Sync stopped. This workspace is still saved here.";
  }
}

/** How many devices the relay has listed, counting this one. */
export function syncPeople(info: SyncInfo | null): number {
  return Math.max(info?.members.length ?? 0, 1);
}

export function roleLabel(role: "owner" | "editor" | "viewer"): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Editor";
    case "viewer":
      return "Viewer";
  }
}
