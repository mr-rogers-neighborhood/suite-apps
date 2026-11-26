/**
 * Host-only chrome.
 *
 * `HostTabBar` and `NewTabPicker` belong to a host's window, not to a pack's content. Packs
 * import the pack-safe entry (`@suite/ui`); Desk and Go import this subpath. Keeping the
 * boundary in the package map means a pack cannot reach host chrome by accident, and the
 * import is visible in review.
 */
export {
  HostTabBar,
  type HostTab,
  type HostTabBarProps,
  type HostTabKind,
} from "./HostTabBar.js";
export {
  NewTabPicker,
  type NewTabPack,
  type NewTabPickerProps,
  type NewTabScreen,
} from "./NewTabPicker.js";
