import type { PackCommandContribution, PackProviderContribution } from "@suite/contracts/commands";

export type { PackCommandContribution, PackProviderContribution } from "@suite/contracts/commands";

/**
 * What a pack offers the host's chrome.
 *
 * A contribution is data. The host validates it, renders it in its own menu,
 * toolbar or palette, and sends the command id back to the pack when a person
 * invokes it. A pack never renders into host DOM.
 *
 * `providers` is the one block the Command Surface added (#224): each entry
 * names a kind, the pack-side entry the host invokes, and the scopes it serves.
 * A provider the manifest does not list is refused, not called.
 */
export interface PackMenuContribution {
  /** `app`, `file`, `edit`, `view`, `window`, `help`, or a pack-defined menu. */
  readonly menu: string;
  /** The command this item invokes. */
  readonly command: string;
  /** Overrides the command title in this menu. */
  readonly label?: string;
  /** Items in the same group are drawn together, in the host's order. */
  readonly group?: string;
  /** Reserved for a future `when` expression; the host ignores it today. */
  readonly when?: string;
}

export interface PackContributions {
  readonly commands?: readonly PackCommandContribution[];
  /** The command, search and scope providers this pack answers calls through. */
  readonly providers?: readonly PackProviderContribution[];
  readonly menus?: readonly PackMenuContribution[];
  /** File extensions the host may route to this pack, for example `.canvas`. */
  readonly fileExtensions?: readonly string[];
  /** `suite://<name>/…` hosts the host may route to this pack. */
  readonly deepLinks?: readonly string[];
}
