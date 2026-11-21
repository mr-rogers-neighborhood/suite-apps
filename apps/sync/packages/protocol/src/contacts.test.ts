import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addContact,
  contactForCode,
  contactsFileSchema,
  learnContact,
  removeContact,
  resolveFriendInvite,
  type SyncContact,
} from "./contacts.js";
import { deriveFriendCode, formatFriendCode } from "./friendCode.js";
import { deviceIdFromPublicKey, type FriendInvite } from "./friendInvite.js";

function key(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
}

function inviteFrom(publicKey: string, overrides: Partial<FriendInvite> = {}): FriendInvite {
  return {
    from: { deviceId: deviceIdFromPublicKey(publicKey) ?? "", publicKey },
    relay: { url: "wss://relay.example:8787/sync", fingerprint: `${"AB:".repeat(31)}AB` },
    workspace: "a".repeat(64),
    invite: "b".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    nonce: "c".repeat(32),
    signature: "signed elsewhere",
    ...overrides,
  };
}

const at = new Date("2026-01-01T00:00:00.000Z");

describe("a contact added by code", () => {
  it("is stored under the canonical code and read back from the display form", () => {
    const code = deriveFriendCode(key());
    const contacts = addContact(
      [],
      { code: formatFriendCode(code).toLowerCase(), name: "Ada" },
      at,
    );

    expect(contacts).toEqual([{ code, name: "Ada", addedAt: at.toISOString(), trusted: true }]);
    expect(contactForCode(contacts, formatFriendCode(code))?.name).toBe("Ada");
  });

  it("is completed when the same code arrives with its key", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const first = addContact([], { code, name: "Ada" }, at);
    const second = addContact(first, { code, name: "Ada Lovelace", publicKey });

    expect(second[0]).toMatchObject({
      code,
      name: "Ada Lovelace",
      publicKey,
      deviceId: deviceIdFromPublicKey(publicKey),
    });
    // Adding the same person does not double the list.
    expect(second).toHaveLength(1);
  });

  it("refuses a key and a code that do not belong together", () => {
    expect(() =>
      addContact([], { code: deriveFriendCode(key()), name: "Ada", publicKey: key() }),
    ).toThrow(/does not belong/u);
  });

  it("treats padded and unpadded spellings of one key as the same device", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const unpadded = publicKey.replace(/=+$/u, "");
    const first = addContact([], { code, name: "Ada", publicKey: unpadded });

    expect(() => addContact(first, { code, name: "Ada Lovelace", publicKey })).not.toThrow();
    const second = addContact(first, { code, name: "Ada Lovelace", publicKey });
    expect(second[0]).toMatchObject({ name: "Ada Lovelace", publicKey: unpadded });
  });

  it("normalises a display form when a contacts file is read", () => {
    const code = deriveFriendCode(key());
    const parsed = contactsFileSchema.parse({
      version: 1,
      contacts: [
        {
          code: formatFriendCode(code).toLowerCase(),
          name: "Ada",
          addedAt: at.toISOString(),
          trusted: true,
        },
      ],
    });
    expect(parsed.contacts[0]?.code).toBe(code);

    expect(
      contactsFileSchema.safeParse({
        version: 1,
        contacts: [{ code: "not a code", name: "Ada", addedAt: at.toISOString(), trusted: true }],
      }).success,
    ).toBe(false);
  });

  it("never replaces an existing key with a different one", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts: SyncContact[] = [
      { code, name: "Ada", publicKey: key(), addedAt: at.toISOString(), trusted: true },
    ];
    expect(() => addContact(contacts, { code, name: "Ada", publicKey })).toThrow(
      /different device/u,
    );
  });

  it("is removed by the code a person sees", () => {
    const code = deriveFriendCode(key());
    const contacts = addContact([], { code, name: "Ada" }, at);
    expect(removeContact(contacts, formatFriendCode(code))).toEqual([]);
  });
});

describe("what an invitation from a contact means", () => {
  const ownCode = deriveFriendCode(key());

  it("is unknown until the person adds the code", () => {
    const publicKey = key();
    const invitation = inviteFrom(publicKey);
    expect(resolveFriendInvite(invitation, [], ownCode)).toEqual({
      status: "unknown",
      code: deriveFriendCode(publicKey),
    });
  });

  it("is known when the code is in the list, even before the key is", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts = addContact([], { code, name: "Ada" }, at);
    expect(resolveFriendInvite(inviteFrom(publicKey), contacts, ownCode)).toMatchObject({
      status: "known",
      code,
      contact: { name: "Ada" },
    });
  });

  it("fills in the key and the device from the first verified invitation", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts = addContact([], { code, name: "Ada" }, at);
    const learned = learnContact(contacts, inviteFrom(publicKey), at);

    expect(learned[0]).toMatchObject({
      code,
      publicKey,
      deviceId: deviceIdFromPublicKey(publicKey),
      lastSeenAt: at.toISOString(),
    });
  });

  it("refuses a contact whose stored key is not the one that signed", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts: SyncContact[] = [
      {
        code,
        name: "Ada",
        publicKey: key(),
        addedAt: at.toISOString(),
        trusted: true,
      },
    ];
    expect(resolveFriendInvite(inviteFrom(publicKey), contacts, ownCode)).toMatchObject({
      status: "key-mismatch",
      code,
    });
  });

  it("accepts the same key written without padding", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts: SyncContact[] = [
      {
        code,
        name: "Ada",
        publicKey: publicKey.replace(/=+$/u, ""),
        addedAt: at.toISOString(),
        trusted: true,
      },
    ];
    expect(resolveFriendInvite(inviteFrom(publicKey), contacts, ownCode)).toMatchObject({
      status: "known",
      code,
    });
  });

  it("never completes a contact with a key that is not the one saved", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const stored: SyncContact = {
      code,
      name: "Ada",
      publicKey: key(),
      addedAt: at.toISOString(),
      trusted: true,
    };
    const learned = learnContact([stored], inviteFrom(publicKey), at);
    expect(learned[0]).toEqual(stored);

    const idOnly: SyncContact = {
      code,
      name: "Ada",
      deviceId: "f".repeat(64),
      addedAt: at.toISOString(),
      trusted: true,
    };
    expect(learnContact([idOnly], inviteFrom(publicKey), at)[0]).toEqual(idOnly);
  });

  it("refuses a contact the person has not marked trusted", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts = addContact([], { code, name: "Ada", trusted: false }, at);
    expect(resolveFriendInvite(inviteFrom(publicKey), contacts, ownCode)).toMatchObject({
      status: "untrusted",
    });
  });

  it("refuses an invitation written for somebody else", () => {
    const publicKey = key();
    const code = deriveFriendCode(publicKey);
    const contacts = addContact([], { code, name: "Ada" }, at);
    const targeted = inviteFrom(publicKey, { to: deriveFriendCode(key()) });

    expect(resolveFriendInvite(targeted, contacts, ownCode)).toMatchObject({
      status: "for-someone-else",
    });
    expect(resolveFriendInvite(targeted, contacts, targeted.to ?? "")).toMatchObject({
      status: "known",
    });
  });

  it("refuses a key that is not 32 bytes", () => {
    const invitation = inviteFrom(key());
    const malformed = { ...invitation, from: { ...invitation.from, publicKey: "AAAA" } };
    expect(resolveFriendInvite(malformed, [], ownCode)).toEqual({ status: "malformed-key" });
  });
});
