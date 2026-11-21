import { formatFriendCode, formatFriendLink, parseFriendCode } from "@suite/sync";
import { useState } from "react";
import { relativeTime } from "../history/historyFormat";
import type { SyncContact, SyncMember, SyncSinceOpened } from "../store/useCanvasStore";
import { FriendQr } from "./FriendQr";

/**
 * The four things the sync dialog can be asking.
 *
 * Each is a question with an answer a person can give in one gesture: share or join, hand over
 * an invitation, keep a way back in, or type the word that opens one. None of them shows a
 * frame, an epoch or a key, because those are how it works and not what anybody is deciding.
 */

export interface LocalFaceProps {
  host: string;
  hubRunning: boolean;
  pasted: string;
  /** The certificate the person copied from the relay's startup line. */
  fingerprint: string;
  /** True when the address or the invitation is `wss://`. */
  showFingerprint: boolean;
  busy: boolean;
  onHost: (value: string) => void;
  onPasted: (value: string) => void;
  onFingerprint: (value: string) => void;
  onShare: () => Promise<void>;
  onJoin: () => Promise<void>;
  onRestore: () => Promise<void>;
  /** When sync last completed here, so a stopped workspace still says what it missed. */
  lastSyncedAt?: string | null;
}

/** Not shared with anyone yet: the two errands, and the door for a device that has a file. */
export function LocalFace({
  host,
  hubRunning,
  pasted,
  fingerprint,
  showFingerprint,
  busy,
  onHost,
  onPasted,
  onFingerprint,
  onShare,
  onJoin,
  onRestore,
  lastSyncedAt = null,
}: LocalFaceProps) {
  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold">Share this workspace</h3>
        <label className="mt-1 block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-host">
          {hubRunning
            ? "This machine is listening here."
            : "Start shows this machine's address. It is not running right now."}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="sync-host"
            value={host}
            onChange={(event) => onHost(event.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onShare()}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Share
          </button>
        </div>
        {showFingerprint ? (
          <div className="mt-2">
            <label className="block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-fingerprint">
              Relay certificate fingerprint
            </label>
            <input
              id="sync-fingerprint"
              value={fingerprint}
              onChange={(event) => onFingerprint(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="AB:CD:EF:…"
              className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 font-mono text-xs"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Copy the SHA-256 line suite-sync prints when it starts. A different certificate stops
              sync; there is no plaintext fallback.
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="text-xs font-semibold">Join one somebody shared</h3>
        <label className="mt-1 block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-link">
          Paste the invitation they sent.
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="sync-link"
            value={pasted}
            onChange={(event) => onPasted(event.target.value)}
            spellCheck={false}
            placeholder="suite://join?…"
            className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy || pasted.trim().length === 0}
            onClick={() => void onJoin()}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Join
          </button>
        </div>
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={() => void onRestore()}
        className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
      >
        I have a recovery file for this workspace
      </button>

      {lastSyncedAt === null ? null : (
        <p data-testid="sync-last-synced" className="text-[11px] text-[var(--ink-muted)]">
          Last synced {relativeTime(Date.parse(lastSyncedAt), Date.now())}. Turn sync on to catch up
          on what changed.
        </p>
      )}
    </div>
  );
}

export interface SyncedFaceProps {
  members: readonly SyncMember[];
  deviceId: string;
  fingerprint?: string | null;
  link: string | null;
  busy: boolean;
  /** Whether to offer a way back in: true only while nobody has answered the question. */
  offerKit: boolean;
  /** The device being removed, so its row can say so. */
  removing: string | null;
  /** What arrived while this workspace was closed; null before any session record. */
  sinceOpened?: SyncSinceOpened | null;
  onSaveKit: () => void;
  onInvite: () => Promise<void>;
  onRemove: (deviceId: string) => Promise<void>;
  onStop: () => Promise<void>;
  run: (work: () => Promise<void>) => Promise<void>;
}

const ROLE_WORDS: Record<string, string> = {
  owner: "in charge",
  editor: "can edit",
  viewer: "can read",
};

/**
 * What arrived while the workspace was closed.
 *
 * Counts, a time and the devices the host already lists. It never claims which card changed:
 * the host holds ciphertext, and the app's own merge cannot attribute an update to a device.
 */
export function SinceOpenedSection({
  updates,
  lastSyncedAt,
  peers,
  nowMs = Date.now(),
}: {
  readonly updates: number;
  readonly lastSyncedAt: string | null;
  /** The other devices in the workspace, by the name the host reports. */
  readonly peers: readonly string[];
  /** Test seam: the clock the sentence is relative to. */
  readonly nowMs?: number;
}) {
  return (
    <section
      data-testid="sync-since-opened"
      className="rounded-md border border-[var(--hairline)] p-2"
    >
      <h3 className="text-xs font-semibold">Since you last opened</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {updates === 0
          ? "Nothing new has arrived on this device yet."
          : `${updates} ${updates === 1 ? "update" : "updates"} arrived from the host.`}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {peers.length === 0
          ? "No other device is listed right now."
          : `Other devices here: ${peers.join(", ")}.`}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {lastSyncedAt === null
          ? "This device has not completed a sync yet."
          : `Last synced ${relativeTime(Date.parse(lastSyncedAt), nowMs)}.`}
      </p>
    </section>
  );
}

/** Shared: what arrived, the invitation to give away, who is here, and one way to leave. */
export function SyncedFace({
  members,
  deviceId,
  fingerprint,
  link,
  busy,
  offerKit,
  removing,
  sinceOpened = null,
  onSaveKit,
  onInvite,
  onRemove,
  onStop,
  run,
}: SyncedFaceProps) {
  // Removal is the owner's decision. The host refuses a removal record anybody else signed,
  // so offering the button to an editor would be a promise the relay has already broken.
  const ownRole = members.find((member) => member.deviceId === deviceId)?.role ?? null;
  const canRemove = ownRole === "owner";
  const peers = members.filter((member) => member.deviceId !== deviceId);
  const peerNames = peers.map((member) => member.name);

  return (
    <div className="mt-4 space-y-4">
      {sinceOpened === null || sinceOpened === undefined ? null : (
        <SinceOpenedSection
          updates={sinceOpened.updates}
          lastSyncedAt={sinceOpened.lastSyncedAt}
          peers={peerNames}
        />
      )}

      <section>
        <h3 className="text-xs font-semibold">Invite someone</h3>
        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
          Send them this. They paste it into their own Canvas, and it lets them in.
        </p>
        <div className="mt-1.5 flex gap-2">
          <output
            data-testid="sync-link"
            className="min-w-0 flex-1 select-all truncate rounded-md border border-[var(--hairline)] px-2 py-1 text-xs"
          >
            {link ?? "No invitation yet"}
          </output>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onInvite)}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            {link === null ? "Make one" : "Make another"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold">Devices here</h3>
        <ul data-testid="sync-members" className="mt-1 space-y-1">
          {members.length === 0 ? (
            <li className="text-[11px] text-[var(--ink-muted)]">Just this device so far.</li>
          ) : null}
          {members.map((member) => (
            <li
              key={member.deviceId}
              className="flex items-start justify-between gap-2 text-xs"
              data-testid="sync-member"
              data-device-id={member.deviceId}
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {member.name}
                  {member.deviceId === deviceId ? " (this device)" : ""}
                </span>
                {/* The name is what a person weighs; the id is what a host pins. */}
                <code
                  className="block truncate font-mono text-[10px] text-[var(--ink-muted)]"
                  title={member.deviceId}
                >
                  {member.deviceId.slice(0, 12)}…
                </code>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-[11px] text-[var(--ink-muted)]">
                  {ROLE_WORDS[member.role] ?? member.role}
                </span>
                {canRemove && member.deviceId !== deviceId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onRemove(member.deviceId))}
                    className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {removing === member.deviceId ? "Removing…" : "Remove"}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {!canRemove && peers.length > 0 ? (
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
            Only the owner can remove a device.
          </p>
        ) : null}
      </section>

      {fingerprint ? (
        <section>
          <h3 className="text-xs font-semibold">Relay certificate</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
            This device only syncs with a relay whose certificate matches this fingerprint.
          </p>
          <output
            data-testid="sync-fingerprint-pinned"
            className="mt-1 block select-all break-all rounded-md border border-[var(--hairline)] px-2 py-1 font-mono text-[11px]"
          >
            {fingerprint}
          </output>
        </section>
      ) : null}

      {offerKit ? (
        <section className="rounded-md border border-[var(--hairline)] p-2">
          <h3 className="text-xs font-semibold">Keep a way back in</h3>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
            This machine cannot restore the workspace, and neither can any other. A file saved now
            can.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onSaveKit}
            className="mt-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Save it
          </button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => void run(onStop)}
        className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
      >
        Stop sharing on this device
      </button>
    </div>
  );
}

export interface KitStepProps {
  busy: boolean;
  onSave: (passphrase: string | null) => Promise<void>;
  onDecline: () => Promise<void>;
}

/** The offer, with the one choice that changes the file. */
export function KitStep({ busy, onSave, onDecline }: KitStepProps) {
  const [passphrase, setPassphrase] = useState("");
  const secret = passphrase.trim().length > 0 ? passphrase : null;

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-kit-passphrase">
        Add a passphrase (optional). Without one, anyone who opens the file becomes this device.
      </label>
      <input
        id="sync-kit-passphrase"
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        className="w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDecline()}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Not now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave(secret)}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] disabled:opacity-50"
        >
          Save the file
        </button>
      </div>
    </div>
  );
}

export interface UnlockStepProps {
  busy: boolean;
  onOpen: (passphrase: string) => Promise<void>;
}

/** The word that opens a sealed file. */
export function UnlockStep({ busy, onOpen }: UnlockStepProps) {
  const [passphrase, setPassphrase] = useState("");

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-unlock">
        Passphrase
      </label>
      <div className="flex gap-2">
        <input
          id="sync-unlock"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy || passphrase.length === 0}
          onClick={() => void onOpen(passphrase)}
          className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Open
        </button>
      </div>
    </div>
  );
}

/**
 * The people this installation knows, and the code it shows in return.
 *
 * A friend code is an identifier, not a password: it names this installation so a signed
 * invitation can be matched to a contact. Adding somebody is the explicit act, so an
 * invitation from a code that is not in this list is refused with the code to add.
 */
export interface FriendsSectionProps {
  friendCode: string;
  /** The same code as a link, or an empty string when there is no code yet. */
  friendLink: string;
  contacts: readonly SyncContact[];
  /** What is being typed into the add form. */
  code: string;
  name: string;
  copied: boolean;
  linkCopied: boolean;
  busy: boolean;
  onCode: (value: string) => void;
  onName: (value: string) => void;
  onAdd: () => void;
  onCopy: () => void;
  onCopyLink: () => void;
  onForget: (code: string) => void;
}

export function FriendsSection({
  friendCode,
  friendLink,
  contacts,
  code,
  name,
  copied,
  linkCopied,
  busy,
  onCode,
  onName,
  onAdd,
  onCopy,
  onCopyLink,
  onForget,
}: FriendsSectionProps) {
  const ownCode = friendCodeDisplay(friendCode);

  return (
    <section
      data-testid="sync-friends"
      className="mt-4 rounded-lg border border-[var(--hairline)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">Your friend code</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
            Give this to someone you trust. It names this installation; it is not a password.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code
            data-testid="friend-code"
            className="rounded-md border border-[var(--hairline)] px-2 py-1 font-mono text-[11px]"
          >
            <span className="sr-only">Your friend code: </span>
            {ownCode === "" ? "…" : ownCode}
          </code>
          <button
            type="button"
            disabled={ownCode === ""}
            onClick={onCopy}
            className="rounded-md px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {friendLink === "" ? null : (
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Or send this link. A scan adds you in one step; the code above is the same value typed
              by hand.
            </p>
            <code
              data-testid="friend-link"
              className="mt-1 block truncate rounded-md border border-[var(--hairline)] px-2 py-1 font-mono text-[10px]"
            >
              {friendLink}
            </code>
            <button
              type="button"
              disabled={busy}
              onClick={onCopyLink}
              className="mt-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
            >
              {linkCopied ? "Link copied" : "Copy link"}
            </button>
          </div>
          <FriendQr payload={friendLink} />
        </div>
      )}

      <div className="mt-3 border-t border-[var(--hairline)] pt-3">
        <h3 className="text-xs font-semibold">People you know</h3>
        {contacts.length === 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
            Nobody yet. Add a friend's code and their invitation will be recognised.
          </p>
        ) : (
          <ul aria-label="Contacts" className="mt-2 space-y-1">
            {contacts.map((contact) => (
              <li
                key={contact.code}
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--hairline)] px-2 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs">{contact.name}</span>
                  <span className="block truncate font-mono text-[10px] text-[var(--ink-muted)]">
                    {friendCodeDisplay(contact.code)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onForget(contact.code)}
                  className="shrink-0 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 border-t border-[var(--hairline)] pt-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-[11px] text-[var(--ink-muted)]">
            Friend code or link
            <input
              value={code}
              onChange={(event) => onCode(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="ABCD-EFGH-JKMN-PQRS or suite://friend?…"
              className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="block text-[11px] text-[var(--ink-muted)]">
            Name
            <input
              value={name}
              onChange={(event) => onName(event.target.value)}
              autoComplete="off"
              placeholder="Ada"
              className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
            />
          </label>
          <button
            type="button"
            disabled={busy || code.trim() === "" || name.trim() === ""}
            onClick={onAdd}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  );
}

/** The display form, without throwing on a value that is not a code yet. */
function friendCodeDisplay(code: string): string {
  const parsed = parseFriendCode(code);
  return parsed.ok ? formatFriendCode(parsed.code) : code;
}

/**
 * The link main built, or the code alone when no key reached the renderer.
 *
 * `main` includes the install key so a scan completes a contact; a host that only knows
 * the code still gets a link that names the installation, and the dialog shows exactly
 * what its QR carries either way.
 */
export function friendLinkFor(link: string | null, code: string): string {
  if (link !== null && link.trim() !== "") return link;
  const parsed = parseFriendCode(code);
  return parsed.ok ? formatFriendLink({ code: parsed.code, publicKey: null }) : "";
}
