# Run the Canvas sync demo

This is the end-to-end demo: two Canvas clients, one user-run `suite-sync` relay, account-free
devices, real document updates. The relay stores sealed frames and the signed records beside them; it
cannot read a document. It is still a development path: loopback by default, no TLS, and no push. Do
not expose it beyond a trusted machine.

## 1. Start a relay

Start supervises a `suite-sync` relay it can find. Open Start's **Sync** pane, turn sync on, and read
**This machine's address** — normally `ws://127.0.0.1:8787/sync`. The relay binds to loopback unless
somebody changes the scope. There is no device registry yet, so the CLI's `--trust-all` means
signatures are not checked; the relay still records each device's key when that device first joins.

From a checkout, the same server is the CLI:

```sh
pnpm --filter @suite/sync-server build
cd apps/sync
node dist/cli.js serve --host 127.0.0.1 --port 8787 --trust-all
curl http://127.0.0.1:8787/health
# {"ok":true,"workspaces":0,"clients":0}
```

The CLI needs `--trust-all` because it has no device-key verifier yet. On loopback that admits
processes on this machine; it is not the flag to use on a network address without understanding that
the relay is then an open mailbox.

## 2. Share on the first device

Open the document in Canvas desktop. Click the status pill that says **Local only**, then in the Sync
dialog use **Share this workspace**:

1. Start's address is already in the field when Start is running. Otherwise type the relay address.
2. Press **Share**. The pill changes to **Syncing · 1**, and the dialog now offers an invitation.
3. Save the **way back in** file when it is offered. It is the only thing that can restore this
   device's copy; the relay cannot.

## 3. Give the second device a copy and an invitation

The joining device needs the same document before it can join, because the workspace id lives in the
file:

1. Copy the `.canvas` file to the other machine. On one machine, use a second Electron data directory
   and a second copy of the file: the writer lock is per path.
2. On the first device press **Make one** under **Invite someone**, and send the `suite://join?…`
   string it produces. The invitation is signed, names the role it grants, and expires.
3. On the second device open its copy of the file, click **Local only**, paste the invitation under
   **Join one somebody shared**, and press **Join**.

The second device says **Waiting** until the first device's app admits it. Admission uses the
invitation, not a second question: the relay spends the invitation, the first device adds the key
package to the group, and the second device receives a welcome and a snapshot of the document.

## 4. Look for

- Both title bars drop **Local only**; the first device shows **Syncing · 2**.
- A card created or renamed in one window appears in the other.
- Presence (a moving cursor) arrives live and is not written into the document.
- Restart the relay: both devices reconnect, ask for what follows their cursor, and catch up. The
  relay's store keeps frames and their positions, not the document.
- In Start's Sync pane, the workspace appears with its frame count and the devices the relay knows.
  Nothing there is a title, a card or any other document content.

## 5. Remove a device

On the first device open the Sync dialog and press **Remove** beside the device. The app sends the MLS
commit that rotates the epoch and the signed removal record the relay can read. It reports success
only after the relay has numbered the commit. The removed device keeps the copy it already has and
cannot read what is sealed after the commit; a fresh invitation is the only way back in.

## Known limits

- **No TLS.** The relay speaks `ws://` and binds to `127.0.0.1` by default. Frames protect content
  from the relay and from disk; they do not protect the header, timing or availability from the
  network. See [the threat model](../threat-model.md).
- **Metadata is visible.** The relay reads the workspace and device ids, epoch, frame kind, payload
  length and arrival time, plus the signed roles, invitations, pinned keys and removals. It reads no
  document content.
- **No push.** A device with the app closed learns nothing until it is opened and reconnects.
- **Retention is finite.** Frames older than 30 days are dropped by default. A device away longer
  needs a snapshot from a peer; the relay never had a document to hand back.
- **The CLI is the relay Start runs.** It records device keys, but there is no device registry yet, so
  `serve` still needs `--trust-all`; Start passes it on loopback and requires the network
  acknowledgement before it will pass it to a reachable address.
