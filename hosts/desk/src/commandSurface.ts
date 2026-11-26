import {
  type CommandOutcome,
  type CommandScope,
  type CommandScopeItem,
  type PackCommandContribution,
  type PackProviderContribution,
  scopeCacheKey,
} from "@suite/contracts/commands";
import type { PackInfo } from "./packs.js";

/**
 * Command Surface discovery, ranking and the small local caches (#224, #225).
 *
 * This module is the deterministic half: it reads declarations, matches text and
 * orders rows. It never invokes a pack and never touches a document. The broker
 * beside it owns the scoped channel and consent.
 */

/** A host-owned command. The host runs it itself; no pack is called. */
export interface HostCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly scope?: string;
  run(): Promise<CommandOutcome>;
}

/** One command as the surface draws and matches it. */
export interface CommandEntry {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly keywords: readonly string[];
  readonly scope: string;
  readonly source: "host" | "pack";
  /** Null for a host command. */
  readonly packId: string | null;
  readonly packName: string;
  /** The declared provider entry the host calls. Null for a host command. */
  readonly provider: string | null;
  readonly icon: string | null;
}

export function hostCommandEntry(command: HostCommand): CommandEntry {
  return {
    id: command.id,
    title: command.title,
    subtitle: command.subtitle ?? "Suite Desk",
    keywords: command.keywords ?? [],
    scope: command.scope ?? "global",
    source: "host",
    packId: null,
    packName: "Suite Desk",
    provider: null,
    icon: null,
  };
}

/** The commands provider a pack declares, or null. */
export function commandsProvider(pack: PackInfo): PackProviderContribution | null {
  return pack.contributions?.providers?.find((provider) => provider.kind === "commands") ?? null;
}

/** The search provider a pack declares, or null. */
export function searchProvider(pack: PackInfo): PackProviderContribution | null {
  return pack.contributions?.providers?.find((provider) => provider.kind === "search") ?? null;
}

/** The scope providers a pack declares. */
export function scopeProviders(pack: PackInfo): readonly PackProviderContribution[] {
  return pack.contributions?.providers?.filter((provider) => provider.kind === "scopes") ?? [];
}

/** Every scope id a pack declares through its scope providers. */
export function declaredScopes(pack: PackInfo): readonly string[] {
  const scopes = new Set<string>();
  for (const provider of scopeProviders(pack)) {
    for (const scope of provider.scopes ?? []) scopes.add(scope);
  }
  return [...scopes].sort((left, right) => left.localeCompare(right));
}

/**
 * The provider entry one command resolves to.
 *
 * A command may name its provider explicitly. Otherwise it uses the pack's
 * single commands provider. A command whose provider is not declared resolves
 * to null and is refused, not called.
 */
export function providerForCommand(
  pack: PackInfo,
  command: PackCommandContribution,
): PackProviderContribution | null {
  const providers =
    pack.contributions?.providers?.filter((provider) => provider.kind === "commands") ?? [];
  const entry = command.provider;
  if (entry === undefined) return providers[0] ?? null;
  return providers.find((provider) => provider.entry === entry) ?? null;
}

/** The declared provider for a scope call, or null. */
export function providerForScope(pack: PackInfo, scopeId: string): PackProviderContribution | null {
  return (
    scopeProviders(pack).find(
      (provider) => provider.scopes === undefined || provider.scopes.includes(scopeId),
    ) ?? null
  );
}

/**
 * The commands a pack offers the surface.
 *
 * Only a pack that declares the `commands` capability and a commands provider
 * contributes entries. A command with no provider is left out rather than shown
 * and then refused; an undeclared provider is refused by the broker.
 */
export function packCommandEntries(pack: PackInfo): readonly CommandEntry[] {
  if (!pack.capabilities.includes("commands")) return [];
  const commands = pack.contributions?.commands ?? [];
  const entries: CommandEntry[] = [];
  for (const command of commands) {
    const provider = providerForCommand(pack, command);
    if (provider === null) continue;
    entries.push({
      id: command.id,
      title: command.title,
      subtitle: command.subtitle ?? pack.name,
      keywords: command.keywords ?? [],
      scope: command.scope ?? "global",
      source: "pack",
      packId: pack.id,
      packName: pack.name,
      provider: provider.entry,
      icon: command.icon ?? null,
    });
  }
  return entries;
}

/** Every command this host can offer: its own first, then installed packs. */
export function discoverCommands(
  packs: readonly PackInfo[],
  hostCommands: readonly HostCommand[],
): readonly CommandEntry[] {
  return [...hostCommands.map(hostCommandEntry), ...packs.flatMap(packCommandEntries)];
}

/** A pack the surface can switch to. A host command has no app. */
export interface CommandApp {
  readonly id: string | null;
  readonly name: string;
  readonly scopes: readonly string[];
}

/** What the surface needs for one listing, independent of the command rows. */
export interface CommandSurfaceListing {
  readonly apps: readonly CommandApp[];
  readonly recent: readonly string[];
  readonly notice: string | null;
}

export function commandApps(
  packs: readonly PackInfo[],
  hostName = "Suite Desk",
): readonly CommandApp[] {
  const apps: CommandApp[] = [{ id: null, name: hostName, scopes: [] }];
  for (const pack of packs) {
    const scopes = declaredScopes(pack);
    const commands = packCommandEntries(pack);
    if (scopes.length === 0 && commands.length === 0) continue;
    apps.push({ id: pack.id, name: pack.name, scopes });
  }
  return apps;
}

function recentIndex(recentIds: readonly string[], id: string): number {
  const index = recentIds.indexOf(id);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * The deterministic match tier: exact title, then prefix, then keyword or
 * substring. `null` means the entry does not match.
 */
export function matchTier(entry: CommandEntry, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 0;
  const title = entry.title.toLowerCase();
  if (title === needle) return 0;
  if (title.startsWith(needle)) return 1;
  if (entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 2;
  if (title.includes(needle)) return 3;
  if ((entry.subtitle ?? "").toLowerCase().includes(needle)) return 4;
  if (entry.id.toLowerCase().includes(needle)) return 5;
  return null;
}

/**
 * Order commands for one query.
 *
 * The recorded order is exact title, prefix, keyword, local recency, title. This
 * implementation keeps the first three as a match tier and then uses recency and
 * title as tie-breakers, so an empty query is recency then title. There is no
 * popularity and no cross-app signal (S12.4).
 */
export function rankCommands(
  entries: readonly CommandEntry[],
  query: string,
  recentIds: readonly string[] = [],
): readonly CommandEntry[] {
  const matched: { readonly entry: CommandEntry; readonly tier: number }[] = [];
  for (const entry of entries) {
    const tier = matchTier(entry, query);
    if (tier !== null) matched.push({ entry, tier });
  }
  matched.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    const leftRecent = recentIndex(recentIds, left.entry.id);
    const rightRecent = recentIndex(recentIds, right.entry.id);
    if (leftRecent !== rightRecent) {
      if (leftRecent === Number.POSITIVE_INFINITY) return 1;
      if (rightRecent === Number.POSITIVE_INFINITY) return -1;
      return leftRecent - rightRecent;
    }
    const title = left.entry.title.localeCompare(right.entry.title);
    if (title !== 0) return title;
    return left.entry.id.localeCompare(right.entry.id);
  });
  return matched.map((match) => match.entry);
}

/**
 * Local, clearable command recency.
 *
 * It is in the host session: it is not written to a profile, not keyed to an
 * app, never transmitted and gone when the host exits. Clearing it empties the
 * list the surface shows.
 */
export class CommandRecency {
  readonly #limit: number;
  #order: string[] = [];

  constructor(limit = 20) {
    this.#limit = limit;
  }

  touch(id: string): void {
    this.#order = [id, ...this.#order.filter((candidate) => candidate !== id)].slice(
      0,
      this.#limit,
    );
  }

  clear(): void {
    this.#order = [];
  }

  order(): readonly string[] {
    return [...this.#order];
  }
}

/** Display rows one scope last returned, with the instant they arrived. */
export interface CachedScopeRows {
  readonly items: readonly CommandScopeItem[];
  readonly fetchedAt: number;
}

/** In-memory display-row cache. It holds rows, never document bytes. */
export class ScopeRowsCache {
  readonly #rows = new Map<string, CachedScopeRows>();

  set(packId: string, scopeId: string, items: readonly CommandScopeItem[], now: number): void {
    this.#rows.set(scopeCacheKey(packId, scopeId), { items, fetchedAt: now });
  }

  get(packId: string, scopeId: string): CachedScopeRows | null {
    return this.#rows.get(scopeCacheKey(packId, scopeId)) ?? null;
  }

  forget(packId: string, scopeId: string): void {
    this.#rows.delete(scopeCacheKey(packId, scopeId));
  }

  clear(): void {
    this.#rows.clear();
  }

  size(): number {
    return this.#rows.size;
  }
}

/**
 * A named placeholder for an app or scope this build cannot resolve.
 *
 * Contract rule: unknown stays visible as a named placeholder, never hidden.
 */
export function unknownScopePlaceholder(packId: string, scopeId?: string): CommandScope {
  return {
    id: scopeId ?? packId,
    title: scopeId === undefined ? `${packId} (not installed)` : `${scopeId} (unknown scope)`,
    subtitle:
      scopeId === undefined
        ? "This app is not installed on this host."
        : `${packId} does not declare the ${scopeId} scope.`,
  };
}

/** The placeholder row a closed pack leaves in place of live rows. */
export function closedScopePlaceholder(packName: string, stale: boolean): CommandScopeItem {
  return {
    id: "placeholder",
    title: stale ? "Open app to refresh" : "Open the app to load this scope",
    subtitle: packName,
    detail: stale
      ? "The rows below were cached while the app was open."
      : "A closed pack cannot answer a scope call.",
  };
}

/** A refusal sentence a person can read. */
export function commandRefusal(packName: string, reason: string): CommandOutcome {
  return { ok: false, message: `${packName}: ${reason}` };
}
