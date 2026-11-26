import type { SyncInfo } from "@suite/planner-core";
import {
  formatFriendCode,
  formatFriendLink,
  parseContactInput,
  parseFriendCode,
} from "@suite/sync";
import { Button, Field, IconButton, Modal, SyncPill } from "@suite/ui";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

import { getBridge } from "../platform/bridge";
import { FriendQr } from "./FriendQr";
import { roleLabel, syncLabel, syncPeople, syncSentence, syncSituation } from "./syncState";

const LOCAL_RELAY = "ws://127.0.0.1:8787/sync";

/**
 * Sync, where a person does it: a pill in the bar and one dialog behind it.
 *
 * The state comes from main, which owns the connection and the keys. This component holds
 * only what is being typed and which name is on screen; nothing here can read a frame, and
 * nothing here opens a socket.
 */
export function SyncControl() {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    if (bridge.onSyncChanged === undefined || bridge.syncStatus === undefined) return;
    const off = bridge.onSyncChanged(setInfo);
    void bridge
      .syncStatus()
      .then(setInfo)
      .catch(() => setInfo(null));
    return off;
  }, []);

  const status = info?.status ?? { state: "off" as const };

  return (
    <>
      <SyncPill
        situation={syncSituation(status)}
        label={syncLabel(status)}
        peerCount={status.state === "off" ? undefined : syncPeople(info)}
        onClick={() => setOpen(true)}
        className="touch"
      />
      <SyncDialog open={open} onClose={() => setOpen(false)} info={info} onInfo={setInfo} />
    </>
  );
}

function SyncDialog({
  open,
  onClose,
  info,
  onInfo,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly info: SyncInfo | null;
  readonly onInfo: (info: SyncInfo) => void;
}) {
  const [host, setHost] = useState(LOCAL_RELAY);
  const [pasted, setPasted] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [friendCode, setFriendCode] = useState("");
  const [friendName, setFriendName] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setCopied(false);
    setCodeCopied(false);
    setLinkCopied(false);
  }, [open]);

  const status = info?.status ?? { state: "off" as const };
  const shared = status.state !== "off" && status.state !== "waiting" && status.state !== "removed";
  // Only a wss:// relay has a certificate to pin. One field serves both errands, read from
  // whichever box is being used, so the two cannot disagree about which relay is meant.
  const secureTarget = /^wss:\/\//iu.test(host.trim()) || /wss(%3A|:)/iu.test(pasted);

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function share(): void {
    void run(async () => {
      const pin = fingerprint.trim();
      const next =
        pin === ""
          ? await getBridge().syncEnable?.(host)
          : await getBridge().syncEnable?.(host, pin);
      if (next !== undefined) onInfo(next);
    });
  }

  function join(): void {
    void run(async () => {
      const pin = fingerprint.trim();
      const next =
        pin === ""
          ? await getBridge().syncJoin?.(pasted)
          : await getBridge().syncJoin?.(pasted, pin);
      if (next !== undefined) onInfo(next);
    });
  }

  function invite(): void {
    void run(async () => {
      const made = (await getBridge().syncInvite?.("editor")) ?? null;
      setLink(made);
      if (made === null) setProblem("Sync is not connected, so no invitation was written.");
    });
  }

  function leave(): void {
    void run(async () => {
      setLink(null);
      const next = await getBridge().syncDisable?.();
      if (next !== undefined) onInfo(next);
    });
  }

  function copy(): void {
    if (link === null) return;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setProblem("That link could not be copied. Select it and copy it by hand."));
  }

  function copyFriendCode(): void {
    const shown = friendCodeDisplay(info?.friendCode ?? "");
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setProblem("That code could not be copied. Select it and copy it by hand.");
      return;
    }
    void clipboard
      .writeText(shown)
      .then(() => setCodeCopied(true))
      .catch(() => setProblem("That code could not be copied. Select it and copy it by hand."));
  }

  function copyFriendLink(): void {
    const shown = friendLinkFor(info?.friendLink ?? null, info?.friendCode ?? "");
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setProblem("That link could not be copied. Select it and copy it by hand.");
      return;
    }
    void clipboard
      .writeText(shown)
      .then(() => setLinkCopied(true))
      .catch(() => setProblem("That link could not be copied. Select it and copy it by hand."));
  }

  function addFriend(): void {
    void run(async () => {
      // A link and a code are two forms of one value; the protocol reads whichever arrived.
      // A refusal is its own sentence, and nothing reaches main.
      const contact = parseContactInput(friendCode);
      if (!contact.ok) {
        setProblem(contact.reason);
        return;
      }
      const next = await getBridge().syncAddContact?.({
        code: contact.value.code,
        name: friendName.trim(),
        ...(contact.value.publicKey !== null ? { publicKey: contact.value.publicKey } : {}),
      });
      if (next !== undefined) onInfo(next);
      setFriendCode("");
      setFriendName("");
    });
  }

  function forgetFriend(code: string): void {
    void run(async () => {
      const next = await getBridge().syncRemoveContact?.(code);
      if (next !== undefined) onInfo(next);
    });
  }

  return (
    <Modal open={open} onClose={onClose} label="Sync" size="md">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Sync</h2>
        <IconButton label="Close sync" className="touch" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{syncSentence(status)}</p>

      <FriendsSection
        info={info}
        code={friendCode}
        name={friendName}
        copied={codeCopied}
        linkCopied={linkCopied}
        busy={busy}
        onCode={setFriendCode}
        onName={setFriendName}
        onAdd={addFriend}
        onCopy={copyFriendCode}
        onCopyLink={copyFriendLink}
        onForget={forgetFriend}
      />

      <div className="mt-4 flex flex-col gap-4">
        {shared ? (
          <SharedBody
            info={info}
            link={link}
            busy={busy}
            copied={copied}
            connected={status.state === "syncing"}
            onInvite={invite}
            onCopy={copy}
            onLeave={leave}
          />
        ) : status.state === "waiting" || status.state === "removed" ? (
          <WaitingBody busy={busy} waiting={status.state === "waiting"} onLeave={leave} />
        ) : (
          <LocalBody
            host={host}
            pasted={pasted}
            fingerprint={fingerprint}
            showFingerprint={secureTarget}
            busy={busy}
            onHost={setHost}
            onPasted={setPasted}
            onFingerprint={setFingerprint}
            onShare={share}
            onJoin={join}
          />
        )}
      </div>

      {problem === null ? null : (
        <p role="alert" className="mt-3 text-[12px] text-[var(--danger)]">
          {problem}
        </p>
      )}
    </Modal>
  );
}

function LocalBody({
  host,
  pasted,
  fingerprint,
  showFingerprint,
  busy,
  onHost,
  onPasted,
  onFingerprint,
  onShare,
  onJoin,
}: {
  readonly host: string;
  readonly pasted: string;
  readonly fingerprint: string;
  readonly showFingerprint: boolean;
  readonly busy: boolean;
  readonly onHost: (value: string) => void;
  readonly onPasted: (value: string) => void;
  readonly onFingerprint: (value: string) => void;
  readonly onShare: () => void;
  readonly onJoin: () => void;
}) {
  return (
    <>
      <div className="rounded-lg border border-line bg-panel p-3">
        <Field
          label="Relay address"
          value={host}
          hint="The machine running suite-sync. Loopback is the safe default."
          onChange={(event) => onHost(event.target.value)}
        />
        {showFingerprint ? (
          <div className="mt-3">
            <Field
              label="Relay certificate fingerprint"
              value={fingerprint}
              hint="Copy the SHA-256 line suite-sync prints at startup. A different certificate stops sync; there is no plaintext fallback."
              onChange={(event) => onFingerprint(event.target.value)}
            />
          </div>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="primary" disabled={busy} onClick={onShare}>
            Share this workspace
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-panel p-3">
        <Field
          label="Join with an invitation"
          value={pasted}
          hint="Open a copy of the same workspace file first; the invitation adds this device to it."
          onChange={(event) => onPasted(event.target.value)}
        />
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || pasted.trim() === ""}
            onClick={onJoin}
          >
            Join
          </Button>
        </div>
      </div>
    </>
  );
}

function WaitingBody({
  busy,
  waiting,
  onLeave,
}: {
  readonly busy: boolean;
  readonly waiting: boolean;
  readonly onLeave: () => void;
}) {
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="secondary" disabled={busy} onClick={onLeave}>
        {waiting ? "Stop waiting" : "Leave"}
      </Button>
    </div>
  );
}

function SharedBody({
  info,
  link,
  busy,
  copied,
  connected,
  onInvite,
  onCopy,
  onLeave,
}: {
  readonly info: SyncInfo | null;
  readonly link: string | null;
  readonly busy: boolean;
  readonly copied: boolean;
  readonly connected: boolean;
  readonly onInvite: () => void;
  readonly onCopy: () => void;
  readonly onLeave: () => void;
}) {
  const members = info?.members ?? [];
  const canInvite = members.some(
    (member) => member.deviceId === info?.deviceId && member.role === "owner",
  );
  return (
    <>
      <div>
        <p className="text-[12px] font-medium text-ink">Devices in this workspace</p>
        {members.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted">The relay has not listed anyone yet.</p>
        ) : (
          <ul aria-label="Devices in this workspace" className="mt-2 flex flex-col gap-1.5">
            {members.map((member) => (
              <li
                key={member.deviceId}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2"
              >
                <span className="min-w-0 truncate text-[12px] text-ink">
                  {member.name}
                  {member.deviceId === info?.deviceId ? (
                    <span className="text-muted"> · this device</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">
                  {roleLabel(member.role)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {connected ? (
        canInvite ? (
          <div className="rounded-lg border border-line bg-panel p-3">
            <p className="text-[12px] font-medium text-ink">Invite someone</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              One person, one use, good for a day. Send the link and keep the workspace file where
              they can open a copy.
            </p>
            {link === null ? (
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="secondary" disabled={busy} onClick={onInvite}>
                  Make an invitation
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  aria-label="Invitation"
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-[11px] text-ink"
                />
                <Button size="sm" variant="secondary" onClick={onCopy}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted">
            Only an owner can invite another device.
          </p>
        )
      ) : (
        <p className="text-[11px] leading-relaxed text-muted">
          Invitations need the relay to answer. When it does, they will use the address this
          workspace was shared at.
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onLeave}>
          Leave
        </Button>
      </div>
    </>
  );
}

/**
 * The people this installation knows, and the code it shows in return.
 *
 * A friend code is an identifier, not a password: it names this installation so a
 * signed invitation can be matched to a contact. Adding somebody is the explicit act,
 * so an invitation from a code that is not in this list is refused with the code to add.
 */
function FriendsSection({
  info,
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
}: {
  readonly info: SyncInfo | null;
  readonly code: string;
  readonly name: string;
  readonly copied: boolean;
  readonly linkCopied: boolean;
  readonly busy: boolean;
  readonly onCode: (value: string) => void;
  readonly onName: (value: string) => void;
  readonly onAdd: () => void;
  readonly onCopy: () => void;
  readonly onCopyLink: () => void;
  readonly onForget: (code: string) => void;
}) {
  const contacts = info?.contacts ?? [];
  const ownCode = friendCodeDisplay(info?.friendCode ?? "");
  const ownLink = friendLinkFor(info?.friendLink ?? null, info?.friendCode ?? "");

  return (
    <section className="mt-4 rounded-lg border border-line bg-panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink">Your friend code</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Give this to someone you trust. It names this installation; it is not a password.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code
            data-testid="friend-code"
            className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] text-ink"
          >
            <span className="sr-only">Your friend code: </span>
            {ownCode === "" ? "…" : ownCode}
          </code>
          <Button size="sm" variant="secondary" disabled={ownCode === ""} onClick={onCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {ownLink === "" ? null : (
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-relaxed text-muted">
              Or send this link. A scan adds you in one step; the code above is the same value typed
              by hand.
            </p>
            <code
              data-testid="friend-link"
              className="mt-1 block truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] text-ink"
            >
              {ownLink}
            </code>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onCopyLink}>
              {linkCopied ? <Check size={13} /> : <Copy size={13} />}
              {linkCopied ? "Link copied" : "Copy link"}
            </Button>
          </div>
          <FriendQr payload={ownLink} />
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[12px] font-medium text-ink">People you know</p>
        {contacts.length === 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Nobody yet. Add a friend's code and their invitation will be recognised.
          </p>
        ) : (
          <ul aria-label="Contacts" className="mt-2 flex flex-col gap-1.5">
            {contacts.map((contact) => (
              <li
                key={contact.code}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink">{contact.name}</span>
                  <span className="block truncate font-mono text-[10px] text-muted">
                    {friendCodeDisplay(contact.code)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onForget(contact.code)}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field
            label="Friend code or link"
            value={code}
            hint="Sixteen symbols, or a suite://friend link from a scan."
            onChange={(event) => onCode(event.target.value)}
          />
          <Field
            label="Name"
            value={name}
            hint="What you will call them here."
            onChange={(event) => onName(event.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || code.trim() === "" || name.trim() === ""}
            onClick={onAdd}
          >
            Add
          </Button>
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
 * Main includes the install key so a scan completes a contact; a host that only knows
 * the code still gets a link that names the installation, and the QR shows exactly the
 * link beside it either way.
 */
function friendLinkFor(link: string | null, code: string): string {
  if (link !== null && link.trim() !== "") return link;
  const parsed = parseFriendCode(code);
  return parsed.ok ? formatFriendLink({ code: parsed.code, publicKey: null }) : "";
}
