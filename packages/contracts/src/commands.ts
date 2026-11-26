import { z } from "zod";

/**
 * The Command Surface vocabulary (S5.2, S11.3, #224).
 *
 * One input has three modes — capture, command and search — and every mode is
 * answered by a host-owned surface over pack declarations. This module owns the
 * words both sides use: the manifest declaration a signed pack carries, the
 * request the host sends over the scoped command channel, and the reply a pack
 * may answer with.
 *
 * Nothing here is a document. The request is a command id, a scope and a record
 * of strings; the reply is display metadata plus a `suite://` link. A handler
 * never receives document bytes, a path or a file handle through this channel.
 */

/** The three provider kinds one `contributions.providers` entry may declare. */
export const COMMAND_PROVIDER_KINDS = ["commands", "search", "scopes"] as const;
export type CommandProviderKind = (typeof COMMAND_PROVIDER_KINDS)[number];

export function isCommandProviderKind(
  value: string,
): value is CommandProviderKind {
  return (COMMAND_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** A command id is the pack-local dotted lower kebab-case shape commands already use. */
export const COMMAND_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u;
/** A scope id is `global`, `documents`, or a provider-defined lower kebab-case id. */
export const SCOPE_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u;
/** A provider entry is a pack-side method name, never a path. */
export const PROVIDER_ENTRY = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u;

export function isCommandId(value: string): boolean {
  return value.length <= 96 && COMMAND_ID.test(value);
}

export function isScopeId(value: string): boolean {
  return value.length <= 64 && SCOPE_ID.test(value);
}

export function isProviderEntry(value: string): boolean {
  return value.length <= 96 && PROVIDER_ENTRY.test(value);
}

/**
 * One provider a pack contributes.
 *
 * The owner's call was one `contributions.providers` block rather than sibling
 * `search`, `scopes` and `capture` lists. Each entry names its kind, the
 * pack-side entry the host invokes, and the scopes it serves. A provider the
 * manifest does not list is refused, not called.
 */
export interface PackProviderContribution {
  readonly kind: CommandProviderKind;
  /** The pack-side entry or method the host calls. Never imported by the host. */
  readonly entry: string;
  /** The scope ids this provider serves. Omitted means every scope it is asked for. */
  readonly scopes?: readonly string[];
}

export const packProviderContributionSchema = z
  .object({
    kind: z.enum(COMMAND_PROVIDER_KINDS),
    entry: z
      .string()
      .refine(isProviderEntry, "a pack-side entry name, not a path"),
    scopes: z
      .array(z.string().refine(isScopeId, "a lower kebab-case scope id"))
      .min(1)
      .max(32)
      .refine(
        (items) => new Set(items).size === items.length,
        "duplicate scope",
      )
      .optional(),
  })
  .strict();

/**
 * The command half of `contributions.commands`.
 *
 * `id` is stable pack-local. The host routes an invocation by it and never
 * guesses the meaning of a title. The rest is display and matching metadata.
 */
export interface PackCommandContribution {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Lower-case strings the deterministic matcher uses; never replaces the title. */
  readonly keywords?: readonly string[];
  /** A pack-relative path listed in `files`; the host draws it in a bounded slot. */
  readonly icon?: string;
  /** `global`, `documents`, or a provider-defined scope id. */
  readonly scope?: string;
  /** The provider entry that answers this command. Omitted means the commands provider. */
  readonly provider?: string;
  readonly category?: string;
  /** Electron-style accelerator, for example `CmdOrCtrl+Shift+K`. */
  readonly keybinding?: string;
}

export const packCommandContributionSchema = z
  .object({
    id: z.string().refine(isCommandId, "a dotted lower kebab-case command id"),
    title: z.string().min(1).max(80),
    subtitle: z.string().min(1).max(120).optional(),
    keywords: z
      .array(
        z
          .string()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9][a-z0-9 -]*$/u),
      )
      .max(12)
      .refine(
        (items) => new Set(items).size === items.length,
        "duplicate keyword",
      )
      .optional(),
    icon: z.string().min(1).max(512).optional(),
    scope: z.string().refine(isScopeId, "a scope id").optional(),
    provider: z
      .string()
      .refine(isProviderEntry, "a pack-side entry name, not a path")
      .optional(),
    category: z.string().min(1).max(40).optional(),
    keybinding: z.string().min(1).max(80).optional(),
  })
  .strict();

/** What the host sends for one command invocation. */
export interface CommandInvocation {
  readonly commandId: string;
  readonly scope: string;
  readonly arguments: Readonly<Record<string, string>>;
}

/** What a pack answers with. `open` is parsed as a `suite://` link by the host. */
export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly open?: string;
}

/** One search result. The host opens it through `open`; it never indexes the content. */
export interface CommandSearchResult {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly open: string;
}

export interface CommandSearchRequest {
  readonly query: string;
  readonly scope: string;
  readonly limit?: number;
}

/** One scope a provider serves. */
export interface CommandScope {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
}

/** One display row a scope provider returns. Display metadata only, never a document. */
export interface CommandScopeItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly detail?: string;
  readonly done?: boolean;
}

/**
 * The scoped command-channel request.
 *
 * It is a discriminated union rather than a free-form method name, so a pack
 * cannot be asked to run something the contract does not name.
 */
export type CommandProviderRequest =
  | {
      readonly kind: "commands";
      readonly commandId: string;
      readonly scope: string;
      readonly arguments: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly scope: string;
      readonly limit?: number;
    }
  | { readonly kind: "scopes"; readonly call: "scopes" }
  | {
      readonly kind: "scopes";
      readonly call: "items";
      readonly scopeId: string;
      readonly limit?: number;
    }
  | {
      readonly kind: "scopes";
      readonly call: "capture";
      readonly scopeId: string;
      readonly values: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "scopes";
      readonly call: "open";
      readonly scopeId: string;
      readonly itemId?: string;
    };

/** The pack's answer to any provider request. Only the fields the kind uses are present. */
export interface CommandProviderResponse {
  readonly ok: boolean;
  readonly message?: string;
  /** A `suite://` link the host routes, never a path or document bytes. */
  readonly open?: string;
  readonly scopes?: readonly CommandScope[];
  readonly items?: readonly CommandScopeItem[];
  readonly results?: readonly CommandSearchResult[];
}

const displayText = (max: number) => z.string().min(1).max(max);
const stringRecord = z
  .record(z.string().max(64), z.string().max(2_000))
  .refine((record) => Object.keys(record).length <= 64, "at most 64 arguments");

const commandProviderRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("commands"),
      commandId: z.string().refine(isCommandId, "a command id"),
      scope: z.string().refine(isScopeId, "a scope id"),
      arguments: stringRecord,
    })
    .strict(),
  z
    .object({
      kind: z.literal("search"),
      query: z.string().max(200),
      scope: z.string().refine(isScopeId, "a scope id"),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("scopes"), call: z.literal("scopes") }).strict(),
  z
    .object({
      kind: z.literal("scopes"),
      call: z.literal("items"),
      scopeId: z.string().refine(isScopeId, "a scope id"),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scopes"),
      call: z.literal("capture"),
      scopeId: z.string().refine(isScopeId, "a scope id"),
      values: stringRecord,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scopes"),
      call: z.literal("open"),
      scopeId: z.string().refine(isScopeId, "a scope id"),
      itemId: z.string().max(128).optional(),
    })
    .strict(),
]);

const commandScopeSchema = z
  .object({
    id: z.string().refine(isScopeId, "a scope id"),
    title: displayText(80),
    subtitle: displayText(120).optional(),
  })
  .strict();

const commandScopeItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: displayText(120),
    subtitle: displayText(160).optional(),
    detail: displayText(200).optional(),
    done: z.boolean().optional(),
  })
  .strict();

const commandSearchResultSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: displayText(120),
    subtitle: displayText(160).optional(),
    open: z.string().min(1).max(2_048),
  })
  .strict();

const commandProviderResponseSchema = z
  .object({
    ok: z.boolean(),
    message: displayText(300).optional(),
    open: z.string().min(1).max(2_048).optional(),
    scopes: z.array(commandScopeSchema).max(50).optional(),
    items: z.array(commandScopeItemSchema).max(50).optional(),
    results: z.array(commandSearchResultSchema).max(50).optional(),
  })
  .strict();

export type CommandParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** A parsed provider answer. */
export type CommandProviderParse = CommandParse<CommandProviderResponse>;
/** A parsed provider request. */
export type CommandProviderRequestParse = CommandParse<CommandProviderRequest>;

/** Refuse a provider request before it crosses the channel, not after a pack sees it. */
export function parseCommandProviderRequest(
  value: unknown,
): CommandProviderRequestParse {
  const parsed = commandProviderRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "invalid provider request",
    };
  }
  return { ok: true, value: parsed.data as CommandProviderRequest };
}

/** Refuse a malformed provider answer rather than painting it. */
export function parseCommandProviderResponse(
  value: unknown,
): CommandProviderParse {
  const parsed = commandProviderResponseSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "invalid provider answer",
    };
  }
  return { ok: true, value: parsed.data as CommandProviderResponse };
}

/**
 * A deterministic key for one scope row cache. It never contains a document id,
 * a path or a document version: rows are display metadata with an age.
 */
export function scopeCacheKey(packId: string, scopeId: string): string {
  return `${packId}\u0000${scopeId}`;
}
