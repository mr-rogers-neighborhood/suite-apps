import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveFriendCode,
  type FriendInvite,
  formatInvite,
  friendInvitePayload,
  type NewContact,
  parseContactInput,
  type RelayWebSocket,
  type SyncContact,
} from "@suite/sync";
import { describe, expect, it } from "vitest";

import { createSyncService } from "../../../../canvas/desktop/src/main/sync/service.js";
import { createPlannerSyncService } from "./service";

/**
 * The friend-code trust loop, side by side in both apps.
 *
 * The mechanics are shared now, but the decision is not: each service verifies the signed
 * envelope and resolves the code against its *own* contacts file. This test is the safety
 * net for that split — it drives the same four cases through both public store APIs and
 * requires the same sentence out, whether the app refuses by returning a status or by
 * throwing.
 */

const workspaceId = "a".repeat(64);
const relayUrl = "ws://127.0.0.1:8787/sync";

interface ParityService {
  identity(): Promise<{ readonly deviceId: string; readonly publicKey: string }>;
  friendCode(): string;
  friendLink(): string;
  contacts(): readonly SyncContact[];
  addContact(input: NewContact): Promise<readonly SyncContact[]>;
  removeContact(code: string): Promise<readonly SyncContact[]>;
  join(
    link: string,
    fingerprint?: string,
  ): Promise<{ readonly state: string; readonly reason?: string }>;
  disconnect(): Promise<void>;
}

interface CreateOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  readonly webSocket: () => RelayWebSocket;
}

type CreateService = (options: CreateOptions) => Promise<ParityService>;

function fakeRelay() {
  let opened = false;
  const listeners = new Map<string, (event?: { data: unknown }) => void>();
  const socket = {
    send: () => undefined,
    close: () => listeners.get("close")?.(),
    addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
      listeners.set(type, listener);
      if (type === "open" && opened) queueMicrotask(() => listener());
    },
  } as unknown as RelayWebSocket;
  return {
    socket,
    open: () => {
      opened = true;
      listeners.get("open")?.();
    },
  };
}

/** Every socket opens by itself, so a join that gets past the trust gate resolves. */
function autoOpeningRelay(): () => RelayWebSocket {
  return () => {
    const relay = fakeRelay();
    queueMicrotask(relay.open);
    return relay.socket;
  };
}

function signedInvite(): {
  readonly code: string;
  readonly publicKey: string;
  readonly link: string;
  readonly friend: FriendInvite;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // 12 bytes of SPKI header, then the 32 raw bytes the protocol carries.
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const encoded = raw.toString("base64");
  const code = deriveFriendCode(encoded);
  const body = {
    from: {
      deviceId: createHash("sha256").update(raw).digest("hex"),
      publicKey: encoded,
    },
    relay: { url: relayUrl, fingerprint: null },
    workspace: workspaceId,
    invite: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  const friend: FriendInvite = {
    ...body,
    signature: sign(null, Buffer.from(friendInvitePayload(body)), privateKey).toString("base64"),
  };
  return {
    code,
    publicKey: encoded,
    link: formatInvite({ host: relayUrl, workspaceId, inviteId: body.invite, friend }),
    friend,
  };
}

function tamperedLink(friend: FriendInvite): string {
  const first = friend.signature.slice(0, 1);
  const signature = `${first === "A" ? "B" : "A"}${friend.signature.slice(1)}`;
  return formatInvite({
    host: relayUrl,
    workspaceId,
    inviteId: friend.invite,
    friend: { ...friend, signature },
  });
}

/** One outcome string per case, so a returned status and a thrown error compare equal. */
async function joinOutcome(service: ParityService, link: string): Promise<string> {
  try {
    const status = await service.join(link);
    return status.state === "refused" ? `refused: ${status.reason ?? ""}` : status.state;
  } catch (error) {
    return `refused: ${error instanceof Error ? error.message : String(error)}`;
  }
}

interface ParityResult {
  readonly codeMatches: boolean;
  readonly linkMatches: boolean;
  readonly unknown: string;
  readonly known: string;
  readonly afterForget: string;
  readonly contactsAfterForget: number;
  readonly tampered: string;
}

async function runApp(
  create: CreateService,
  invite: ReturnType<typeof signedInvite>,
): Promise<ParityResult> {
  const dataDir = await mkdtemp(join(tmpdir(), "suite-sync-parity-"));
  const webSocket = autoOpeningRelay();
  const service = await create({ dataDir, workspaceId, webSocket });

  try {
    const self = await service.identity();
    const codeMatches = service.friendCode() === deriveFriendCode(self.publicKey);
    const parsedLink = parseContactInput(service.friendLink());
    const linkMatches = parsedLink.ok && parsedLink.value.code === service.friendCode();

    const unknown = await joinOutcome(service, invite.link);

    await service.addContact({
      code: invite.code,
      name: "The other person",
      publicKey: invite.publicKey,
    });
    const known = await joinOutcome(service, invite.link);
    const tampered = await joinOutcome(service, tamperedLink(invite.friend));

    const afterForgetList = await service.removeContact(invite.code);
    const afterForget = await joinOutcome(service, invite.link);

    return {
      codeMatches,
      linkMatches,
      unknown,
      known,
      afterForget,
      contactsAfterForget: afterForgetList.length,
      tampered,
    };
  } finally {
    await service.disconnect();
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe("the friend-code trust loop", () => {
  it("accepts and refuses identically in Canvas and Planner", async () => {
    // One invitation, both apps: the refusal sentence names the inviter's code, so a second
    // invitation would prove nothing about agreement.
    const invite = signedInvite();
    const [canvas, planner] = await Promise.all([
      runApp(createSyncService, invite),
      runApp(createPlannerSyncService, invite),
    ]);

    // The whole result, not just the happy path: a shared mechanic that drifted in one app
    // fails here even if each app's own suite still agrees with itself.
    expect(canvas).toEqual(planner);

    expect(canvas.codeMatches).toBe(true);
    expect(canvas.linkMatches).toBe(true);
    expect(canvas.unknown).toMatch(/^refused: This invitation is from friend code /u);
    expect(canvas.known).toBe("waiting");
    expect(canvas.afterForget).toBe(canvas.unknown);
    expect(canvas.contactsAfterForget).toBe(0);
    expect(canvas.tampered).toMatch(/signature is not valid/u);
  });
});
