import type { InviteState, MemberRole } from "@suite/sync";
/**
 * The relay's console: a loopback page for the person running the mailbox.
 *
 * It reads the relay's own tables — workspace ids, frame counts, epochs, connected
 * sockets, roles and the names devices chose — and nothing else. There is no frame
 * payload on this page and no device key: the console is a window on metadata the
 * relay already reads to admit traffic.
 *
 * It is a separate listener on 127.0.0.1, never the relay's own socket. A relay on
 * `0.0.0.0` is reachable from the network; its console must not be. Binding loopback
 * and requiring a random token is the whole access policy, and no CORS header is sent
 * because no other origin has any business reading this.
 */
/** The part of a hosted room the console is allowed to read. */
export interface ConsoleRoom {
    readonly workspaceId: string;
    readonly log: {
        readonly length: number;
        readonly newestEpoch: number | null;
    };
    readonly sockets: ReadonlySet<unknown>;
    readonly roles: {
        readonly roles: Readonly<Record<string, MemberRole>>;
    };
    readonly keys: ReadonlyMap<string, {
        readonly name: string;
    }>;
    readonly invites: InviteState;
}
export interface RelayConsoleOptions {
    readonly rooms: () => readonly ConsoleRoom[];
    readonly version: string;
    readonly protocolVersion: string | number;
    /** Where the relay keeps its frames, and the directory whose size is reported. */
    readonly store: string;
    /** The address a device would be given, not the bind address. */
    readonly relayUrl: string;
    readonly bind: string;
    readonly fingerprint: string | null;
    readonly now?: () => Date;
}
export interface RelayConsole {
    readonly host: string;
    readonly port: number;
    /** The one URL that carries the token. Printed once at startup. */
    readonly url: string;
    readonly token: string;
    close(): Promise<void>;
}
export interface ConsoleMember {
    readonly name: string;
    readonly role: MemberRole;
}
export interface ConsoleWorkspace {
    readonly workspaceId: string;
    readonly frames: number;
    readonly newestEpoch: number | null;
    readonly connectedDevices: number;
    readonly members: readonly ConsoleMember[];
}
export interface ConsoleState {
    readonly status: "running";
    readonly version: string;
    readonly protocolVersion: string | number;
    readonly secure: boolean;
    readonly relayUrl: string;
    readonly bind: string;
    readonly store: {
        readonly path: string;
        readonly bytes: number;
    };
    readonly fingerprint: string | null;
    readonly workspaces: readonly ConsoleWorkspace[];
    /** `suite://relay?...` for a scanning client, including a live invitation when one exists. */
    readonly relayLink: string;
    /** When the page's numbers were read. */
    readonly checkedAt: string;
}
export declare function createRelayConsole(options: RelayConsoleOptions): Promise<RelayConsole>;
/**
 * The address a device would be given, rather than the address the relay bound.
 *
 * `0.0.0.0` is a bind, not somewhere a client can connect; handing it out is how a
 * relay guide produces a link that works nowhere. A wildcard becomes this machine's
 * first reachable IPv4 address, and loopback stays loopback.
 */
export declare function advertisedRelayUrl(host: string, port: number, secure: boolean): string;
//# sourceMappingURL=console.d.ts.map