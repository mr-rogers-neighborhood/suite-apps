import {
  type CommandOutcome,
  type CommandProviderRequest,
  type CommandProviderResponse,
  type CommandScope,
  type CommandScopeItem,
  type CommandSearchResult,
  isScopeId,
  parseCommandProviderResponse,
} from "@suite/contracts/commands";
import {
  type CommandApp,
  type CommandEntry,
  CommandRecency,
  type CommandSurfaceListing,
  closedScopePlaceholder,
  commandApps,
  commandRefusal,
  declaredScopes,
  discoverCommands,
  type HostCommand,
  hostCommandEntry,
  providerForCommand,
  providerForScope,
  rankCommands,
  ScopeRowsCache,
  scopeProviders,
  searchProvider,
  unknownScopePlaceholder,
} from "./commandSurface.js";
import type { PackInfo } from "./packs.js";

/** The sender the scoped command channel is scoped to. It never names a pack from the renderer. */
export interface CommandProviderSender {
  readonly packId: string;
  readonly webContentsId: number;
}

/** The host side of the scoped channel. Tests inject a fake. */
export interface CommandChannel {
  invoke(
    sender: CommandProviderSender,
    entry: string,
    request: CommandProviderRequest,
  ): Promise<unknown>;
}

export interface CommandBrokerOptions {
  packs(): readonly PackInfo[];
  hostCommands: readonly HostCommand[];
  /** The live renderer for a pack, or null when no tab has it open. */
  findSender(packId: string): CommandProviderSender | null;
  /** Ask for the `commands` capability at its install tier. False is a refusal. */
  ensureConsent(pack: PackInfo): Promise<boolean>;
  /** Send one request over the separate command channel. */
  channel: CommandChannel;
  recency?: CommandRecency;
  cache?: ScopeRowsCache;
  now?: () => number;
}

/** One command the surface may show. */
export interface CommandMatch {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly scope: string;
  readonly source: "host" | "pack";
  readonly packId: string | null;
  readonly packName: string;
  readonly keywords: readonly string[];
}

export interface CommandListing extends CommandSurfaceListing {
  readonly commands: readonly CommandMatch[];
}

export interface ScopeView {
  readonly ok: boolean;
  readonly scopes: readonly CommandScope[];
  readonly items: readonly CommandScopeItem[];
  /** Age of the cached rows in milliseconds, or null when they are live. */
  readonly ageMs: number | null;
  readonly stale: boolean;
  readonly placeholder: boolean;
  readonly message: string | null;
}

export interface SearchHit {
  readonly packId: string;
  readonly packName: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly open: string;
}

export interface SearchView {
  readonly ok: boolean;
  readonly hits: readonly SearchHit[];
  readonly message: string | null;
}

function plainArguments(value: unknown): Readonly<Record<string, string>> | null {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length > 64) return null;
  const clean: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (typeof item !== "string" || key.length === 0 || key.length > 64 || item.length > 2_000) {
      return null;
    }
    clean[key] = item;
  }
  return clean;
}

/** Only a `suite://` link may be handed back to the host to route. */
export function suiteOpenLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "suite:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function outcomeFrom(response: CommandProviderResponse, fallback: string): CommandOutcome {
  const message =
    response.message !== undefined && response.message.length > 0 ? response.message : fallback;
  const open = suiteOpenLink(response.open);
  return {
    ok: response.ok,
    message,
    ...(open === null ? {} : { open }),
  };
}

function scopeTitle(id: string): string {
  const words = id.replace(/[._-]+/gu, " ").trim();
  return words.length === 0 ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Command Surface broker.
 *
 * It reads declarations, asks consent, invokes only a declared provider entry
 * over the separate command channel, and caches display rows by pack and scope.
 * It never reads or writes a pack document.
 */
export class CommandBroker {
  readonly #options: CommandBrokerOptions;
  readonly #recency: CommandRecency;
  readonly #cache: ScopeRowsCache;
  readonly #now: () => number;

  constructor(options: CommandBrokerOptions) {
    this.#options = options;
    this.#recency = options.recency ?? new CommandRecency();
    this.#cache = options.cache ?? new ScopeRowsCache();
    this.#now = options.now ?? (() => Date.now());
  }

  packs(): readonly PackInfo[] {
    return this.#options.packs();
  }

  apps(): readonly CommandApp[] {
    return commandApps(this.packs());
  }

  recent(): readonly string[] {
    return this.#recency.order();
  }

  clearRecents(): void {
    this.#recency.clear();
  }

  listing(query: string): CommandListing {
    const entries = discoverCommands(this.packs(), this.#options.hostCommands);
    const ordered = rankCommands(entries, query, this.#recency.order());
    return {
      commands: ordered.map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: entry.subtitle,
        scope: entry.scope,
        source: entry.source,
        packId: entry.packId,
        packName: entry.packName,
        keywords: entry.keywords,
      })),
      apps: commandApps(this.packs()),
      recent: this.#recency.order(),
      notice: null,
    };
  }

  /** Run one command. A host command runs locally; a pack command crosses the channel. */
  async invoke(
    commandId: string,
    scope = "global",
    rawArguments: unknown = {},
  ): Promise<CommandOutcome> {
    const command = this.#declaredCommands().find((entry) => entry.id === commandId);
    if (command === undefined) {
      return { ok: false, message: `No command named ${commandId} is installed.` };
    }
    if (!isScopeId(scope)) {
      return { ok: false, message: `${scope} is not a scope id.` };
    }

    if (command.source === "host") {
      const host = this.#options.hostCommands.find((candidate) => candidate.id === commandId);
      if (host === undefined) return { ok: false, message: `No command named ${commandId}.` };
      const outcome = await host.run();
      if (outcome.ok) this.#recency.touch(commandId);
      return outcome;
    }

    const packId = command.packId;
    if (packId === null) return { ok: false, message: `${command.title} has no pack.` };
    const pack = this.packs().find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      return { ok: false, message: `${command.packName} is not installed.` };
    }
    if (!pack.capabilities.includes("commands")) {
      return commandRefusal(pack.name, "it did not declare the commands capability.");
    }

    const declaration = (pack.contributions?.commands ?? []).find(
      (candidate) => candidate.id === commandId,
    );
    if (declaration === undefined) {
      return commandRefusal(pack.name, `${commandId} is not declared in its manifest.`);
    }
    const provider = providerForCommand(pack, declaration);
    if (provider === null) {
      return commandRefusal(
        pack.name,
        `${commandId} names a provider the manifest does not declare.`,
      );
    }

    const argumentsValue = plainArguments(rawArguments);
    if (argumentsValue === null) {
      return commandRefusal(pack.name, "its arguments are not a record of strings.");
    }

    let allowed: boolean;
    try {
      allowed = await this.#options.ensureConsent(pack);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return commandRefusal(pack.name, "commands are off for this pack. Ask again on its card.");
    }

    const sender = this.#options.findSender(pack.id);
    if (sender === null) {
      return { ok: false, message: `Open ${pack.name} to run ${command.title}.` };
    }

    const request: CommandProviderRequest = {
      kind: "commands",
      commandId,
      scope,
      arguments: argumentsValue,
    };
    const parsed = await this.#call(sender, provider.entry, request, pack.name);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const outcome = outcomeFrom(parsed.value, `${command.title} ran.`);
    if (outcome.ok) this.#recency.touch(commandId);
    return outcome;
  }

  /** The scopes a pack serves, by declared ids until its renderer answers. */
  async scopes(packId: string): Promise<ScopeView> {
    const pack = this.packs().find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      return {
        ok: false,
        scopes: [unknownScopePlaceholder(packId)],
        items: [],
        ageMs: null,
        stale: false,
        placeholder: true,
        message: `${packId} is not installed on this host.`,
      };
    }

    const declared = declaredScopes(pack);
    const provider = scopeProviders(pack)[0];
    if (provider === undefined) {
      return {
        ok: false,
        scopes: [unknownScopePlaceholder(pack.id)],
        items: [],
        ageMs: null,
        stale: false,
        placeholder: true,
        message: `${pack.name} declares no scope provider.`,
      };
    }

    const sender = this.#options.findSender(pack.id);
    if (sender === null) {
      return {
        ok: true,
        scopes: declared.map((id) => ({ id, title: scopeTitle(id), subtitle: pack.name })),
        items: [],
        ageMs: null,
        stale: false,
        placeholder: declared.length === 0,
        message: declared.length === 0 ? `${pack.name} declares no scopes.` : null,
      };
    }

    const parsed = await this.#call(
      sender,
      provider.entry,
      { kind: "scopes", call: "scopes" },
      pack.name,
    );
    if (!parsed.ok) {
      return {
        ok: false,
        scopes: declared.map((id) => ({ id, title: scopeTitle(id), subtitle: pack.name })),
        items: [],
        ageMs: null,
        stale: false,
        placeholder: declared.length === 0,
        message: parsed.message,
      };
    }
    return {
      ok: parsed.value.ok,
      scopes: parsed.value.scopes ?? [],
      items: [],
      ageMs: null,
      stale: false,
      placeholder: (parsed.value.scopes ?? []).length === 0,
      message: parsed.value.message ?? null,
    };
  }

  /** Rows for one scope. A closed pack leaves cached rows with an age. */
  async items(packId: string, scopeId: string, limit = 20): Promise<ScopeView> {
    const pack = this.packs().find((candidate) => candidate.id === packId);
    if (pack === undefined) {
      return this.#placeholderItems(packId, scopeId, `${packId} is not installed on this host.`);
    }
    if (!isScopeId(scopeId)) {
      return this.#placeholderItems(packId, scopeId, `${scopeId} is not a scope id.`);
    }

    const provider = providerForScope(pack, scopeId);
    if (provider === null) {
      return this.#placeholderItems(
        packId,
        scopeId,
        `${pack.name} does not declare the ${scopeId} scope.`,
      );
    }

    const sender = this.#options.findSender(pack.id);
    if (sender === null) return this.#cachedOrPlaceholder(pack, scopeId);

    const parsed = await this.#call(
      sender,
      provider.entry,
      { kind: "scopes", call: "items", scopeId, limit },
      pack.name,
    );
    if (!parsed.ok) return this.#cachedOrPlaceholder(pack, scopeId, parsed.message);

    const items = parsed.value.items ?? [];
    this.#cache.set(pack.id, scopeId, items, this.#now());
    return {
      ok: parsed.value.ok,
      scopes: [],
      items,
      ageMs: 0,
      stale: false,
      placeholder: items.length === 0,
      message: parsed.value.message ?? (items.length === 0 ? "No rows in this scope." : null),
    };
  }

  /** Capture into one scope. The pack validates the values itself. */
  async capture(packId: string, scopeId: string, rawValues: unknown): Promise<CommandOutcome> {
    const pack = this.packs().find((candidate) => candidate.id === packId);
    if (pack === undefined) return { ok: false, message: `${packId} is not installed.` };
    if (!pack.capabilities.includes("commands")) {
      return commandRefusal(pack.name, "it did not declare the commands capability.");
    }
    const provider = providerForScope(pack, scopeId);
    if (provider === null) {
      return commandRefusal(pack.name, `it does not declare the ${scopeId} scope.`);
    }
    const values = plainArguments(rawValues);
    if (values === null) {
      return commandRefusal(pack.name, "its capture values are not a record of strings.");
    }

    let allowed: boolean;
    try {
      allowed = await this.#options.ensureConsent(pack);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return commandRefusal(pack.name, "commands are off for this pack. Ask again on its card.");
    }

    const sender = this.#options.findSender(pack.id);
    if (sender === null) {
      return { ok: false, message: `Open ${pack.name} to capture into ${scopeId}.` };
    }

    const parsed = await this.#call(
      sender,
      provider.entry,
      { kind: "scopes", call: "capture", scopeId, values },
      pack.name,
    );
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const outcome = outcomeFrom(parsed.value, `Captured into ${scopeId}.`);
    if (outcome.ok) this.#cache.forget(pack.id, scopeId);
    return outcome;
  }

  /** Open one row, or the whole scope when no item is named. */
  async open(packId: string, scopeId: string, itemId?: string): Promise<CommandOutcome> {
    const pack = this.packs().find((candidate) => candidate.id === packId);
    if (pack === undefined) return { ok: false, message: `${packId} is not installed.` };
    const provider = providerForScope(pack, scopeId);
    if (provider === null) {
      return commandRefusal(pack.name, `it does not declare the ${scopeId} scope.`);
    }
    const sender = this.#options.findSender(pack.id);
    if (sender === null) {
      return { ok: false, message: `Open ${pack.name} to open that row.` };
    }
    const parsed = await this.#call(
      sender,
      provider.entry,
      { kind: "scopes", call: "open", scopeId, ...(itemId === undefined ? {} : { itemId }) },
      pack.name,
    );
    if (!parsed.ok) return { ok: false, message: parsed.message };
    return outcomeFrom(parsed.value, `Opened ${scopeId}.`);
  }

  /**
   * Ask every open pack with a search provider. The host aggregates display
   * metadata and opens a hit through its deep link; it never indexes content.
   */
  async search(query: string, scope = "global", limit = 20): Promise<SearchView> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return { ok: true, hits: [], message: null };

    const hits: SearchHit[] = [];
    const messages: string[] = [];
    for (const pack of this.packs()) {
      if (!pack.capabilities.includes("commands")) continue;
      const provider = searchProvider(pack);
      if (provider === null) continue;
      const sender = this.#options.findSender(pack.id);
      if (sender === null) {
        messages.push(`Open ${pack.name} to search it.`);
        continue;
      }
      const parsed = await this.#call(
        sender,
        provider.entry,
        { kind: "search", query: trimmed, scope, limit },
        pack.name,
      );
      if (!parsed.ok) {
        messages.push(parsed.message);
        continue;
      }
      for (const result of parsed.value.results ?? []) {
        const open = suiteOpenLink(result.open);
        if (open === null) continue;
        hits.push({
          packId: pack.id,
          packName: pack.name,
          id: result.id,
          title: result.title,
          subtitle: result.subtitle ?? pack.name,
          open,
        });
      }
    }
    hits.sort(
      (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
    );
    return { ok: true, hits: hits.slice(0, limit), message: messages[0] ?? null };
  }

  /**
   * Every declared command, including a pack that lost the capability or names a
   * provider this build cannot resolve. Listing filters those out; invocation
   * still finds them so the refusal names the real reason instead of pretending
   * the command does not exist.
   */
  #declaredCommands(): readonly CommandEntry[] {
    const host = this.#options.hostCommands.map(hostCommandEntry);
    const packs = this.packs().flatMap((pack) =>
      (pack.contributions?.commands ?? []).map((command) => {
        const provider = providerForCommand(pack, command);
        return {
          id: command.id,
          title: command.title,
          subtitle: command.subtitle ?? pack.name,
          keywords: command.keywords ?? [],
          scope: command.scope ?? "global",
          source: "pack" as const,
          packId: pack.id,
          packName: pack.name,
          provider: provider?.entry ?? null,
          icon: command.icon ?? null,
        };
      }),
    );
    return [...host, ...packs];
  }

  async #call(
    sender: CommandProviderSender,
    entry: string,
    request: CommandProviderRequest,
    packName: string,
  ): Promise<
    | { readonly ok: true; readonly value: CommandProviderResponse }
    | { readonly ok: false; readonly message: string }
  > {
    let raw: unknown;
    try {
      raw = await this.#options.channel.invoke(sender, entry, request);
    } catch (error) {
      return {
        ok: false,
        message: `${packName} did not answer: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const parsed = parseCommandProviderResponse(raw);
    if (!parsed.ok) return { ok: false, message: `${packName} answered with ${parsed.message}.` };
    return { ok: true, value: parsed.value };
  }

  #placeholderItems(packId: string, _scopeId: string, message: string): ScopeView {
    return {
      ok: false,
      scopes: [],
      items: [closedScopePlaceholder(packId, false)],
      ageMs: null,
      stale: false,
      placeholder: true,
      message,
    };
  }

  #cachedOrPlaceholder(pack: PackInfo, scopeId: string, message?: string): ScopeView {
    const cached = this.#cache.get(pack.id, scopeId);
    if (cached === null) {
      return {
        ok: false,
        scopes: [],
        items: [closedScopePlaceholder(pack.name, false)],
        ageMs: null,
        stale: false,
        placeholder: true,
        message: message ?? `Open ${pack.name} to load ${scopeId}.`,
      };
    }
    return {
      ok: true,
      scopes: [],
      items: cached.items,
      ageMs: Math.max(0, this.#now() - cached.fetchedAt),
      stale: true,
      placeholder: cached.items.length === 0,
      message: message ?? `Open ${pack.name} to refresh.`,
    };
  }
}

export type { CommandEntry, CommandSearchResult, HostCommand };
