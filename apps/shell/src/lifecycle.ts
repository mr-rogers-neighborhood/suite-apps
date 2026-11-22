import type { PackShellTab, ShellTab } from "./shared.js";

/**
 * What removing one installed version does to open tabs.
 *
 * A tab's view is bound to the version that loaded it, and the host does not keep
 * a second copy of that binding. Any open tab for the pack is therefore closed
 * before the version directory is removed, whichever version it loaded, and the
 * notice says how many. Removing a version with no tab open is unaffected.
 */
export interface UninstallPlan {
  /** Tabs to close before the version directory is removed. */
  readonly closeTabs: readonly string[];
  /** True when at least one open tab had to close. */
  readonly closesOpenTabs: boolean;
}

export function planUninstall(tabs: readonly ShellTab[], packId: string): UninstallPlan {
  const closeTabs = packTabsFor(tabs, packId).map((tab) => tab.id);
  return { closeTabs, closesOpenTabs: closeTabs.length > 0 };
}

/** The open pack tabs for one pack, ignoring screen tabs and other packs. */
export function packTabsFor(tabs: readonly ShellTab[], packId: string): readonly PackShellTab[] {
  return tabs.filter((tab): tab is PackShellTab => tab.kind === "pack" && tab.packId === packId);
}
