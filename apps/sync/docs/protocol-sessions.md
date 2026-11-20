# The sync protocol, as a session type

The relay protocol stated as a **multiparty session type**: one global description of the conversation, and a
projection to each participant that says what that participant may do and — more usefully — what it may
_know_.

Two properties we argue for elsewhere in prose stop being arguments here:

| Property                       | Where it is argued today                              | What it is here                                                        |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| The host is blind              | [Decisions](reference/decisions.md), the threat model | the host's projection mentions the document payload only inside `seal` |
| A stale-epoch frame is ignored | [Decisions](reference/decisions.md), `service.ts`     | a frame from a past epoch is not a conforming message                  |

That is the whole purpose. It is not a proof of security and it is not a runtime check; see
[what this does not cover](#what-this-does-not-cover) before citing it.

## Participants and notation

`D` is a device (there are many; every rule below is per-device and never relies on how many), `H` is the
host. `?` receives, `!` sends, `.` is then, `⊕` is a choice the _other_ party makes, `*` repeats.

The document payload is a type variable `τ` and appears only as `seal(τ)`. That is deliberate: it is the
formal statement of "the host never learns a domain".

## The global type

```text
Sync(τ) =
    D → H : join(ws, dev, pk, name, invite?)
    H → D : joined(members) ⊕ waiting(promise) ⊕ refused(reason)

  . ( D → H : invite(record)
      H → D : invited(inviteId) ⊕ refused(reason) )*

  . ( D → H : keypackage(inviteId, dev, kp)
      H → D : frame(index, seal(commit))            -- the host numbers it and hands it back
      H → D' : waiting(dev, role)                   -- to every peer, before the frame
      H → D' : frame(index, seal(commit)) )*

  . ( D → H : role(record)
      H → D : applied(dev, role, seq) ⊕ refused(reason)
      H → D' : roster(members) )*

  . ( D → H : frame(epoch, seal(τ))
      H → D : frame(index, epoch, seal(τ))          -- numbered: this *is* the acknowledgement
      H → D' : frame(index, epoch, seal(τ))         -- forwarded, unread
    | D → H : since(after)
      H → D : frame(index, epoch, seal(τ))*         -- replay from the log, no terminal ack
    | D → H : ephemeral(seal(presence))
      H → D' : ephemeral(seal(presence))            -- forwarded, never stored
    )*

  . ( D → H : removal(record)
      H → D : roster(members)
      H → D'': removed )                            -- D'' is the device being removed
```

Two details the wire already has and the type makes explicit:

- **The acknowledgement and the delivery are the same message.** A device learns its frame was accepted by
  receiving it back with an `index`. That is why a reader must compare `deviceId` to tell its own work from
  a peer's — there is no separate `stored` reply, and inventing one would be a second source of truth about
  ordering.
- **`waiting` arrives before the frame it describes**, because a device is added with the role its
  invitation promised. Announcing afterwards would make the owner hold the frame back or guess.

## Projections

### To the host

```text
H_local : join?
        . (joined ⊕ waiting ⊕ refused)
        . (invite . (invited ⊕ refused))*
        . (keypackage . frame!) (waiting · frame!)*
        . (role . (applied ⊕ refused) . roster!)*
        . (frame . frame! | since . frame!* | ephemeral . ephemeral!)*
        . (removal . roster! · removed!)*
```

**`H_local` contains `seal(τ)` nowhere as a value it can open.** It carries those bytes, numbers them, and
forwards them. It has no branch that depends on `τ`, no operation that produces a `τ`, and no operation that
compares two. That is the projection form of "blind", and it is checkable by inspection: if a proposed
protocol change needs the host to _do_ something with the payload, this type stops projecting.

Note what `H_local` also does not contain: any notion of an epoch being valid. The host copies `epoch` and
never acts on it, which is why epoch conformance is a device obligation (§ [To a device](#to-a-device)) and
not something a blind host could enforce.

### To a device

```text
D_local : join! . (joined ⊕ waiting ⊕ refused)
        . (invite! . (invited ⊕ refused))*
        . (keypackage! . frame? · (waiting? · frame?)*
          | frame?                                  -- a peer's key package, forwarded
          )*
        . (role! . (applied ⊕ refused) . roster?
          | roster?                                 -- somebody else's change
          )*
        . ( frame!(epoch, seal(τ)) . frame?(index)  -- own frame, numbered
          | since!(after) . frame?*
          | frame?(epoch, seal(τ)) )                -- a peer's
        . (removal! . roster? | roster? | removed)
```

The epoch rule lives here, and only here:

> **A received `frame(epoch, …)` is conforming only while `epoch ≥ my epoch`.** At a lower epoch it is not a
> late message; it is not a message of this session at all, so dropping it is the default rather than a rule
> to remember.

This is not a stylistic preference. The alternative was measured: a stale commit is _decrypted_ with
retained receiver data and applied as an ordinary application message, "not an error — silently absorbed,
epoch unchanged". The library will not refuse it for you. `service.ts` implements the guard and
`service.test.ts` (`ignores a frame from an epoch it has left`) is the test.

**That single sentence is the reason this page exists.** Without it, every new client re-derives the rule
from an ADR; with it, a projection has the rule built in.

## Changing the protocol

**Project first, then change.** The order matters, because a change that breaks a projection is a change that
breaks either blindness or conformance, and it is much cheaper to notice in a type than in a review.

| Proposed change                                      | Does it project?                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a field to `frame` that the host must interpret  | **No.** `H_local` would need an operation on `τ`. The change is either device-to-device (put it inside `seal`) or it makes the host a reader |
| Let the host notify peers which document advanced    | **No.** Same reason, and it is why the doorbell is opaque (`docs/reference/blind-doorbell-proposal.md` in suite-go)                          |
| Add a `stored(index)` acknowledgement                | Yes, but do not: the numbered echo already is one, and a second confirmation is a second ordering story                                      |
| Have the host refuse a frame at a stale epoch        | It cannot — `H_local` has no epoch test, and adding one would mean the host comparing things it was told but cannot verify                   |
| Add a new capability-scoped request (e.g. `files.*`) | Yes: it is a new branch in `D_local`, restricted by the pack's declared capabilities                                                         |

## What this does not cover

**Security, at all.** Session types assume participants follow the type and give you _safety_ (no
communication errors) and _progress_ (a well-typed session never gets stuck) over possibly-lossy channels.
They do **not** model a Byzantine peer, and our relay is explicitly untrusted. Forgery, replay, traffic
analysis and size side-channels are answered in [the threat model](threat-model.md) and nowhere here.

The two questions are disjoint on purpose. Reading "the host's projection is parametric in τ" as "the host
cannot learn your document" is only true against an _honest_ host: it says the design never asks the host to
read, not that a malicious one is prevented. The encryption is what stops that, and MLS is what stops a
removed device.

**Unbounded participant count.** Multiparty session types are decidable for a fixed participant set; "a
device and any number of peers" is the parameterised corner. Nothing above relies on the count — every rule
is per-device — but a claim about arbitrary N would need more theory than this page.

## Where this came from

Written after the pairing handshake was restated as a two-party session type
([suite-go's pairing note](../../go/docs/reference/pairing-protocol.md)),
where the same substitution paid immediately: a linear-logic formula that _looked_ like a protocol turned out
not to be one. The lesson transferred — a choreography written out is worth more than a calculus gestured at.
