/**
 * What a pack offers the host's chrome.
 *
 * A contribution is data. The host validates it, renders it in its own menu,
 * toolbar or palette, and sends the command id back to the pack when a person
 * invokes it. A pack never renders into host DOM.
 */
export interface PackCommandContribution {
  /** Stable command id. The host routes invocations by this value. */
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  /** Electron-style accelerator, for example `CmdOrCtrl+Shift+K`. */
  readonly keybinding?: string;
}

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
  readonly menus?: readonly PackMenuContribution[];
  /** File extensions the host may route to this pack, for example `.canvas`. */
  readonly fileExtensions?: readonly string[];
  /** `suite://<name>/…` hosts the host may route to this pack. */
  readonly deepLinks?: readonly string[];
}
