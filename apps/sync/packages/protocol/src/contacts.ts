import { z } from "zod";
import { decodeBase64, decodeBase64Url } from "./base64.js";
import { deriveFriendCode, parseFriendCode } from "./friendCode.js";
import { deviceIdFromPublicKey, type FriendInvite } from "./friendInvite.js";
import { deviceIdSchema } from "./ids.js";

/**
 * The contact value type, and the decision an invitation gets.
 *
 * Contacts are app data: each app's main process keeps its own file, and this module
 * owns only the shape and the pure rules for reading one. Nothing here reads or writes
 * a file, and nothing here talks to a directory.
 */

/**
 * The code a contacts file stores is the canonical one: sixteen upper-case symbols with no
 * separators. Reading the display form here would let a hand-edited file hold a code that
 * no lookup can find, so a valid display form is normalised on the way in.
 */
const friendCodeSchema = z.string().transform((value, context) => {
  const parsed = parseFriendCode(value);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.reason });
    return z.NEVER;
  }
  return parsed.code;
});

export const syncContactSchema = z
  .object({
    /** The canonical code, which is also the key in the app's file. */
    code: friendCodeSchema,
    /** The name the person gave them. Never supplied by a relay. */
    name: z.string().min(1).max(120),
    /** Filled in when the code came with a key, or by the first signed invitation. */
    deviceId: deviceIdSchema.optional(),
    /** Base64 of the 32 raw Ed25519 bytes; the half a code cannot be reversed into. */
    publicKey: z.string().min(1).optional(),
    addedAt: z.string().min(1),
    lastSeenAt: z.string().min(1).optional(),
    /** Marked by the person. Adding a contact is the explicit act, so this starts true. */
    trusted: z.boolean(),
  })
  .strict();

export type SyncContact = z.infer<typeof syncContactSchema>;

export const contactsFileSchema = z
  .object({
    version: z.literal(1),
    contacts: z.array(syncContactSchema),
  })
  .strict();

export type ContactsFile = z.infer<typeof contactsFileSchema>;

export type FriendInviteResolution =
  | { readonly status: "known"; readonly code: string; readonly contact: SyncContact }
  | { readonly status: "unknown"; readonly code: string }
  | { readonly status: "untrusted"; readonly code: string; readonly contact: SyncContact }
  | { readonly status: "key-mismatch"; readonly code: string; readonly contact: SyncContact }
  | { readonly status: "for-someone-else"; readonly code: string }
  | { readonly status: "malformed-key" };

export interface NewContact {
  readonly code: string;
  readonly name: string;
  readonly publicKey?: string;
  readonly deviceId?: string;
  readonly trusted?: boolean;
}

/** The contact a code names, or undefined. Separators and lower case are read the same. */
export function contactForCode(
  contacts: readonly SyncContact[],
  code: string,
): SyncContact | undefined {
  const parsed = parseFriendCode(code);
  if (!parsed.ok) return undefined;
  return contacts.find((contact) => contact.code === parsed.code);
}

/**
 * Add a contact, or complete one that was added by code alone.
 *
 * A key and a code are checked against each other before either is stored. Re-adding a
 * code updates the name and, when a key is supplied, fills in what was missing; it never
 * replaces a key that is already there with a different one.
 */
export function addContact(
  contacts: readonly SyncContact[],
  input: NewContact,
  now: Date = new Date(),
): readonly SyncContact[] {
  const code = parseFriendCode(input.code);
  if (!code.ok) throw new Error(code.reason);
  // A device id is only meaningful with the key that implies it. Accepting one alone would
  // store an unverifiable claim and then refuse the honest invitation that disagrees with it.
  if (input.deviceId !== undefined && input.publicKey === undefined) {
    throw new Error("A contact device id needs its public key.");
  }
  if (input.publicKey !== undefined && deriveFriendCode(input.publicKey) !== code.code) {
    throw new Error("That public key does not belong to that friend code.");
  }
  const impliedDeviceId =
    input.publicKey === undefined ? null : deviceIdFromPublicKey(input.publicKey);
  if (input.publicKey !== undefined && impliedDeviceId === null) {
    throw new Error("That public key is not 32 bytes of base64.");
  }
  if (
    input.deviceId !== undefined &&
    impliedDeviceId !== null &&
    input.deviceId !== impliedDeviceId
  ) {
    throw new Error("That device id and public key do not belong together.");
  }
  const deviceId = input.deviceId ?? impliedDeviceId ?? undefined;

  const existing = contacts.find((contact) => contact.code === code.code);
  if (existing === undefined) {
    return [
      ...contacts,
      {
        code: code.code,
        name: input.name,
        addedAt: now.toISOString(),
        trusted: input.trusted ?? true,
        ...(input.publicKey !== undefined ? { publicKey: input.publicKey } : {}),
        ...(deviceId !== undefined ? { deviceId } : {}),
      },
    ];
  }

  if (
    existing.publicKey !== undefined &&
    input.publicKey !== undefined &&
    !samePublicKey(existing.publicKey, input.publicKey)
  ) {
    throw new Error("That friend code already belongs to a different device.");
  }

  return contacts.map((contact) =>
    contact.code === code.code
      ? {
          ...contact,
          name: input.name,
          ...(contact.publicKey === undefined && input.publicKey !== undefined
            ? { publicKey: input.publicKey }
            : {}),
          ...(contact.deviceId === undefined && deviceId !== undefined ? { deviceId } : {}),
        }
      : contact,
  );
}

export function removeContact(
  contacts: readonly SyncContact[],
  code: string,
): readonly SyncContact[] {
  const parsed = parseFriendCode(code);
  if (!parsed.ok) return contacts;
  return contacts.filter((contact) => contact.code !== parsed.code);
}

/**
 * What this device should do with a signed invitation.
 *
 * The inviter's code is derived from the key in the envelope, not read from a field, so a
 * contact cannot be matched to a code that the key does not hash to. An unknown code is
 * refused rather than trusted on first use: adding a contact stays the explicit act.
 */
export function resolveFriendInvite(
  invite: FriendInvite,
  contacts: readonly SyncContact[],
  ownCode: string,
): FriendInviteResolution {
  let inviterCode: string;
  try {
    inviterCode = deriveFriendCode(invite.from.publicKey);
  } catch {
    return { status: "malformed-key" };
  }

  if (invite.to !== undefined) {
    // The recipient may have signed the display form. Compare codes, not strings, so a
    // hyphen or lower case in a signed `to` does not turn an invitation for this device
    // into one addressed to somebody else.
    const own = parseFriendCode(ownCode);
    const target = parseFriendCode(invite.to);
    if (!own.ok || !target.ok || own.code !== target.code) {
      return { status: "for-someone-else", code: inviterCode };
    }
  }

  const contact = contacts.find((entry) => entry.code === inviterCode);
  if (contact === undefined) return { status: "unknown", code: inviterCode };
  if (contact.publicKey !== undefined && !samePublicKey(contact.publicKey, invite.from.publicKey)) {
    return { status: "key-mismatch", code: inviterCode, contact };
  }
  if (contact.deviceId !== undefined && contact.deviceId !== invite.from.deviceId) {
    return { status: "key-mismatch", code: inviterCode, contact };
  }
  if (!contact.trusted) return { status: "untrusted", code: inviterCode, contact };
  return { status: "known", code: inviterCode, contact };
}

/**
 * Complete a contact with what a verified invitation proved.
 *
 * This is how a code-only contact becomes a full one. The key was already matched to the
 * code by the caller, so this only records it and moves `lastSeenAt`.
 */
export function learnContact(
  contacts: readonly SyncContact[],
  invite: FriendInvite,
  now: Date = new Date(),
): readonly SyncContact[] {
  let code: string;
  try {
    code = deriveFriendCode(invite.from.publicKey);
  } catch {
    return contacts;
  }
  return contacts.map((contact) => {
    if (contact.code !== code) return contact;
    // Never complete a contact with a key that is not the one already stored. The resolver
    // refuses that mismatch; this keeps a direct caller from doing the same thing silently.
    if (
      contact.publicKey !== undefined &&
      !samePublicKey(contact.publicKey, invite.from.publicKey)
    ) {
      return contact;
    }
    if (
      contact.publicKey === undefined &&
      contact.deviceId !== undefined &&
      contact.deviceId !== invite.from.deviceId
    ) {
      return contact;
    }
    return {
      ...contact,
      deviceId: invite.from.deviceId,
      publicKey: invite.from.publicKey,
      lastSeenAt: now.toISOString(),
    };
  });
}

/**
 * Whether two base64 strings name the same 32 raw bytes.
 *
 * A padded, unpadded or URL-safe spelling of one key decodes to the same bytes, and a
 * contact saved by one platform must still match an invitation written by another. A
 * value that will not decode is never equal to anything.
 */
function samePublicKey(first: string, second: string): boolean {
  if (first === second) return true;
  const left = decodeBase64(first) ?? decodeBase64Url(first);
  const right = decodeBase64(second) ?? decodeBase64Url(second);
  if (left === null || right === null || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
