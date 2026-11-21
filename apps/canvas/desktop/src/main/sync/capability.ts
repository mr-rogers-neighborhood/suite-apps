import {
  type SuiteSyncCapability,
  SuiteSyncCapabilityError,
  type SuiteSyncErrorCode,
  type SuiteSyncFrame,
  type SuiteSyncMember,
  type SuiteSyncMembershipChange,
  type SuiteSyncMembershipNotice,
} from "@suite/contracts";

import type { SyncService } from "./service.js";

/**
 * Canvas's sync, seen through the `suite.sync` contract.
 *
 * The four doors and the status stay exactly as the window already knows them; this file only
 * names them the way a host will. The document and the group key stay here, and the renderer
 * still never sees either.
 *
 * A host that implements `SuiteSyncCapability` later receives sealed frames from the app or
 * pack. Today the service does the sealing inside `send` and the opening before `onFrame`, so
 * the relay still sees ciphertext and the window still sees document bytes.
 */
export interface CanvasSyncCapabilityOptions {
  readonly service: SyncService;
  /** The sync identity of the workspace this service belongs to. */
  readonly workspaceId: string;
}

export function createCanvasSyncCapability(
  options: CanvasSyncCapabilityOptions,
): SuiteSyncCapability {
  const { service, workspaceId } = options;
  const frameListeners = new Set<(frame: SuiteSyncFrame) => void>();
  const membershipListeners = new Set<(notice: SuiteSyncMembershipNotice) => void>();
  let listening = false;

  const members = (): SuiteSyncMember[] =>
    service.members().map((member) => ({
      deviceId: member.deviceId,
      name: member.name,
      role: member.role,
    }));

  const announce = (change: SuiteSyncMembershipChange): void => {
    const notice = { change, members: members() };
    for (const listener of membershipListeners) listener(notice);
  };

  /**
   * Bind to the service once and fan out to whoever asked.
   *
   * The service keeps one handler per event; the contract hands every caller its own
   * unsubscribe. One forwarding handler is what lets both be true without a second socket
   * subscription.
   */
  const listen = (): void => {
    if (listening) return;
    listening = true;
    service.onUpdate((update) => {
      for (const listener of frameListeners) listener(update);
    });
    service.onMembers(() => announce("roster"));
  };

  return {
    async status() {
      return service.status();
    },

    async enable(requestedWorkspaceId, relayUrl) {
      if (requestedWorkspaceId !== workspaceId) {
        throw new SuiteSyncCapabilityError(
          "enable",
          "wrong-workspace",
          "That workspace is not the one this window has open.",
        );
      }
      if (!/^wss?:\/\//u.test(relayUrl)) {
        throw new SuiteSyncCapabilityError(
          "enable",
          "bad-relay",
          "A relay address starts with ws:// or wss://.",
        );
      }
      return service.connect(relayUrl);
    },

    async disable() {
      await service.disconnect();
      return { state: "off" };
    },

    async invite(role) {
      try {
        return await service.createInvite(role);
      } catch (error) {
        const code: SuiteSyncErrorCode =
          service.status().state === "off" ? "not-connected" : "refused";
        throw new SuiteSyncCapabilityError(
          "invite",
          code,
          messageOf(error, "The invitation could not be written."),
        );
      }
    },

    async join(link) {
      try {
        return await service.join(link);
      } catch (error) {
        throw failed("join", error, "That invitation could not be used.");
      }
    },

    async members() {
      return members();
    },

    async send(frame) {
      try {
        await service.publish(frame);
      } catch (error) {
        throw failed("send", error, "The update could not be sent.");
      }
    },

    onFrame(listener) {
      frameListeners.add(listener);
      listen();
      return () => {
        frameListeners.delete(listener);
      };
    },

    onMembership(listener) {
      membershipListeners.add(listener);
      listen();
      return () => {
        membershipListeners.delete(listener);
      };
    },
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Name the failure by the call, and keep the service's sentence for the person. */
function failed(
  operation: "join" | "send",
  error: unknown,
  fallback: string,
): SuiteSyncCapabilityError {
  const message = messageOf(error, fallback);
  return new SuiteSyncCapabilityError(operation, codeFor(message), message);
}

function codeFor(message: string): SuiteSyncErrorCode {
  if (/another workspace/iu.test(message)) return "wrong-workspace";
  if (/already in/iu.test(message)) return "already-member";
  if (/invitation|link/iu.test(message)) return "bad-link";
  if (/not connected/iu.test(message)) return "not-connected";
  if (/not answering/iu.test(message)) return "unreachable";
  if (/removed/iu.test(message)) return "removed";
  return "refused";
}
