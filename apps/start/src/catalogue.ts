import {
  SUITE_APPS,
  type SuiteAppName,
  type SuiteCapability,
  type SuiteReleaseChannel,
} from "@suite/contracts";
import { preReleaseIdFor } from "./channels.js";

/**
 * What the suite offers, whether or not it is on this machine.
 *
 * Start used to list what it found. A list of what is found is empty on a new machine,
 * and empty is the one answer the front door cannot give. So the catalogue names every
 * app the suite has; the store decides what can be installed, and discovery decides
 * whether it is already here.
 *
 * **No feed lives here.** Linux desktop apps ship as Flatpaks, so the update channel is
 * an OSTree remote. Start compares commits in `nativePackageBackend.ts`; it does not
 * read a signed AppImage manifest.
 */

/** One app the suite offers. */
export interface CatalogueEntry {
  readonly id: string;
  /** What a person calls it. Also what an installed manifest will say. */
  readonly name: string;
  /** The folder under the documents root. */
  readonly folder: SuiteAppName;
  readonly extensions: readonly string[];
  readonly capabilities: readonly SuiteCapability[];
  readonly channel: SuiteReleaseChannel;
  /**
   * Whether this entry is the one pre-release identity for its app.
   *
   * Stable is the default: a build with no pre-release identity is stable. The
   * pre-release id is `slop-<app>` and every tier shares it.
   */
  readonly preRelease?: boolean;
}

/** The hub's own id. It is not one of the apps the hub lists. */
export const SELF_ID = "start";

/**
 * The three document apps.
 *
 * Every field here mirrors that app's own `suite.app.json`: the id, the name, the
 * extension, the capabilities and the channel. A test cannot read a sibling
 * checkout, so it checks what can be checked — that the ids, folders and extensions
 * agree with `SUITE_APPS` — and this comment carries the rest.
 */
export const CATALOGUE_APPS = [
  {
    id: "canvas",
    name: "Suite Canvas",
    folder: "Canvas",
    extensions: ["canvas"],
    capabilities: ["document.file", "sync", "attachments", "publish"],
    channel: "alpha",
  },
  {
    id: "planner",
    name: "Suite Planner",
    folder: "Planner",
    extensions: ["planner"],
    capabilities: ["document.file"],
    channel: "alpha",
  },
  {
    id: "budget",
    name: "Suite Budget",
    folder: "Budget",
    extensions: ["budget"],
    capabilities: ["document.file"],
    channel: "alpha",
  },
] as const satisfies readonly CatalogueEntry[];

/**
 * The one pre-release entry per app.
 *
 * Every tier shares `slop-<app>` and therefore one card; the tier is the Flatpak
 * ref branch, not the id. A pre-release is a store branch, so it carries no feed.
 */
export const PRE_RELEASE_CATALOGUE_APPS = CATALOGUE_APPS.map(
  (entry): CatalogueEntry => ({
    ...entry,
    id: preReleaseIdFor(entry.id),
    name: `${entry.name} (pre-release)`,
    preRelease: true,
  }),
);

/**
 * Help, which ships only through the store.
 *
 * It is listed with the stable apps so the hub has a card before the store answers,
 * and it never enters the pre-release table: there is no pre-release identity for a
 * tier to replace.
 */
export const FLATPAK_CATALOGUE_APPS = [
  {
    id: "help",
    name: "Suite Help",
    folder: "Help",
    extensions: [],
    capabilities: [],
    channel: "alpha",
  },
] as const satisfies readonly CatalogueEntry[];

/** Stable apps, the pre-release identity of each, then the Help card. */
export const ALL_CATALOGUE_APPS: readonly CatalogueEntry[] = [
  ...CATALOGUE_APPS,
  ...PRE_RELEASE_CATALOGUE_APPS,
  ...FLATPAK_CATALOGUE_APPS,
];

/** Whether the catalogue still says the same thing `SUITE_APPS` does. */
export function catalogueMatchesContracts(): readonly string[] {
  return [...CATALOGUE_APPS, ...FLATPAK_CATALOGUE_APPS].flatMap((entry) => {
    const contract = SUITE_APPS.find((app) => app.id === entry.id);
    if (contract === undefined) return [`${entry.id} is not in SUITE_APPS`];
    const problems: string[] = [];
    if (contract.folder !== entry.folder) problems.push(`${entry.id} folder`);
    if ((contract.extension ?? null) !== (entry.extensions[0] ?? null)) {
      problems.push(`${entry.id} extension`);
    }
    return problems;
  });
}

/** The hub's own row: a name and a channel. */
export const SELF_ENTRY: CatalogueEntry = {
  id: SELF_ID,
  name: "Suite Start",
  folder: "Start",
  extensions: [],
  capabilities: [],
  channel: "alpha",
};

/** What the catalogue knows about one app. */
export interface CatalogueApp extends CatalogueEntry {
  /** The version installed here, or null when this machine does not have it. */
  readonly installed: string | null;
}

export interface CatalogueOptions {
  /** What is installed here, by app id: the version that discovery reports. */
  readonly installed: ReadonlyMap<string, string>;
}

/**
 * The catalogue after one store change: the new version, and nothing else re-read.
 *
 * Discovery is the authority on what is installed; this only keeps the table in
 * step between a successful install and the next listing.
 */
export function withInstalled(
  catalogue: readonly CatalogueApp[],
  id: string,
  version: string | null,
): readonly CatalogueApp[] {
  return catalogue.map((entry) => (entry.id === id ? { ...entry, installed: version } : entry));
}

/**
 * Every app the suite offers, each with what is installed.
 *
 * The hub's own row is included, and always last.
 */
export async function readCatalogue(options: CatalogueOptions): Promise<readonly CatalogueApp[]> {
  const entry = (candidate: CatalogueEntry): CatalogueApp => ({
    ...candidate,
    installed: options.installed.get(candidate.id) ?? null,
  });
  return [...ALL_CATALOGUE_APPS.map(entry), entry({ ...SELF_ENTRY })];
}
