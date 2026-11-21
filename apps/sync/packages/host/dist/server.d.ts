import { type InviteState, type MemberRole, type RemovalState, type RoleState, type RoleVerifier } from "@suite/sync";
import { WebSocket } from "ws";
import { FrameLog, type FrameVerifier } from "./blindRoom.js";
import { type HostStore, type PinnedKey } from "./store.js";
import { type TlsMaterial } from "./tls.js";
/**
 * The host: a mailbox with an opinion about who may post.
 *
 * It accepts frames, numbers them, writes them down and hands out the ones a client has
 * not seen. It answers no question about a document, because it cannot read one.
 */
export interface HostedRoom {
    readonly workspaceId: string;
    readonly log: FrameLog;
    roles: RoleState;
    /** Invitations an owner wrote. A live one lets exactly one key package through. */
    invites: InviteState;
    /** Devices an owner has taken out, and when. */
    removals: RemovalState;
    /**
     * Each device's key and the name it introduced itself with.
     *
     * The key is what makes verification possible after a restart; the name is what makes the
     * device recognisable to the person deciding whether to let it in, and the invitation it
     * spent is what answers "as what".
     */
    readonly keys: Map<string, {
        readonly publicKey: string;
        readonly name: string;
        readonly invitedWith?: {
            readonly inviteId: string;
            readonly role: MemberRole;
        };
    }>;
    readonly sockets: Set<WebSocket>;
}
export declare class HostRegistry {
    private readonly rooms;
    add(room: HostedRoom): void;
    get(workspaceId: string): HostedRoom | undefined;
    list(): readonly HostedRoom[];
    get size(): number;
}
export interface SyncServerOptions {
    readonly registry: HostRegistry;
    /** 0 asks the operating system for a free port; useful in tests. */
    readonly port?: number;
    readonly host?: string;
    readonly store?: HostStore;
    /** Device key check for incoming frames, against the key the device joined with. */
    readonly verifyFrame: FrameVerifier;
    /** The same check for role records. */
    readonly verifyRole: RoleVerifier;
    /** How long a frame is kept. A device away longer needs a snapshot from a peer. */
    readonly retentionDays?: number;
    readonly now?: () => Date;
    /**
     * Serve `wss://` with this certificate and key.
     *
     * Required on any address other than loopback. The certificate is normally self-signed:
     * clients pin its SHA-256 rather than trusting a chain, so there is no authority to ask.
     */
    readonly tls?: TlsMaterial;
    /**
     * Accept a plaintext bind on a reachable address.
     *
     * Off by default and never inferred. A relay that faces a network without TLS is a
     * deliberate choice, and the CLI is where a person makes it explicitly.
     */
    readonly allowPlaintext?: boolean;
}
export interface SyncServer {
    readonly host: string;
    readonly port: number;
    /** `ws://host:port/sync` or `wss://host:port/sync`. */
    readonly url: string;
    /** SHA-256 of the serving certificate, when there is one. */
    readonly fingerprint: string | null;
    readonly secure: boolean;
    close(): Promise<void>;
}
export declare function createSyncServer(options: SyncServerOptions): Promise<SyncServer>;
/** Keeps the pinned-key shape visible to callers that seed a room directly. */
export type { PinnedKey };
//# sourceMappingURL=server.d.ts.map