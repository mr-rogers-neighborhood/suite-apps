import type { PackInfo } from "./packs.js";
import type { ShellTab } from "./shared.js";

/**
 * Which pack sources the host combines at boot.
 *
 * Signed packs are the load path. An unsigned directory is a development
 * convenience, so it needs both a checkout and an explicit switch: a packaged
 * build and an ordinary `pnpm start` load only verified installs.
 */

export interface DevPackGate {
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** True only when an unpackaged app was started with `SUITE_SHELL_DEV_PACKS=1`. */
export function devPacksEnabled({ isPackaged, env }: DevPackGate): boolean {
  return !isPackaged && env.SUITE_SHELL_DEV_PACKS === "1";
}

export interface PackSources {
  readonly installed: readonly PackInfo[];
  readonly development: readonly PackInfo[];
}

/**
 * Merge installed and development packs by id, then sort by name.
 *
 * A development pack wins a collision because the person running it is editing
 * that directory; the installed copy stays on disk untouched. Callers pass an
 * empty `development` list unless the dev gate opened.
 */
export function mergePackSources({ installed, development }: PackSources): readonly PackInfo[] {
  const byId = new Map<string, PackInfo>();
  for (const pack of installed) byId.set(pack.id, pack);
  for (const pack of development) byId.set(pack.id, pack);

  return [...byId.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

/**
 * Whether a finished install should open its pack.
 *
 * A pack that is already open keeps its loaded view — its protocol handler is
 * bound to the version that loaded — so opening it again would only add a
 * duplicate tab. Only a pack with no tab opens.
 */
export function shouldOpenAfterInstall(
  tabs: readonly Pick<ShellTab, "packId">[],
  packId: string,
): boolean {
  return !tabs.some((tab) => tab.packId === packId);
}
