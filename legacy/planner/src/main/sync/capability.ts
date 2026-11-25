import {
  type SuiteSyncCapability,
  SuiteSyncCapabilityError,
  type SuiteSyncErrorCode,
  type SuiteSyncFrame,
  type SuiteSyncMember,
  type SuiteSyncMembershipChange,
  type SuiteSyncMembershipNotice,
} from "@suite/contracts";

import type { PlannerSyncService } from "./service";

/**
 * Planner's sync, seen through the `suite.sync` contract.
 *
 * This is an adapter, not a refactor. It forwards the four doors and the status the service
 * already has, so the menu bar and the document do not move. What changes is the seam: a host
 * that implements the contract later can replace this file, while Planner keeps its document
 * and its keys.
 *
 * The frame channel is the same pair of doors the service already exposes: `send` carries what
 * the app hands over and the service seals it before the relay sees anything, and `onFrame`
 * delivers what the service opened. A host implementing this contract receives the sealed
 * frames instead, and never the document bytes.
 */
export interface PlannerSyncCapabilityOptions {
  readonly service: PlannerSyncService;
  /** The sync identity of the workspace this service belongs to. */
  readonly workspaceId: string;
}

export function createPlannerSyncCapability(
  options: PlannerSyncCapabilityOptions,
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
   * Bind to the service once, and fan out to whoever asked.
   *
   * The service keeps one handler per event; the contract returns an unsubscribe per listener.
   * One forwarding handler is what lets both be true without a second subscription to a socket.
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
        // A refusal is answered: "no invitation yet" with no reason is the quiet failure a
        // person cannot act on.
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

/** Name the failure by what the caller asked for, keeping the service's wording for a person. */
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
