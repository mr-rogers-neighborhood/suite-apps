/**
 * `@suite/ui` — the one component base the suite shares.
 *
 * Every component is a typed export over plain elements and, where a primitive already owns
 * the hard part, Radix. Nothing here reads a store, remembers a theme, or ships a stylesheet:
 * colour, type, space, radius, elevation and motion arrive as the custom properties
 * `@suite/theme` publishes, so one component works in every pack and every preset.
 *
 * ## Consuming this
 *
 * 1. Add the package at a tag, like `@suite/contracts`.
 * 2. Teach Tailwind to scan the built package, or every class compiles to nothing:
 *
 *    ```css
 *    @source "../../node_modules/@suite/ui/dist";
 *    ```
 *
 * 3. Publish the token layers on the view that hosts the component. One `:root` sheet carries
 *    both: the colour roles from `cssVariables(preset, mode)` and the type, density, radius,
 *    shadow and motion layers from `scaleVariables(density)`. `themeCss()` in `hosts/desk`
 *    writes both before first paint, so a pack reads `var(--token)` and imports nothing.
 *    `@suite/ui` falls back to the values that shipped when a document has no host sheet.
 *
 * 4. React 19 is a peer, not a dependency.
 */
export { AppMark, type AppMarkProps, type AppMarkSize } from "./AppMark.js";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button.js";
export { type ClassValue, cx } from "./cx.js";
export { EmptyState, type EmptyStateProps } from "./EmptyState.js";
export { Field, type FieldProps } from "./Field.js";
export { IconButton, type IconButtonProps, type IconButtonSize } from "./IconButton.js";
export type { ImportOption } from "./ImportMenu.js";
export { Launch, type LaunchProps, type LaunchRecent } from "./Launch.js";
export { Modal, type ModalProps } from "./Modal.js";
export { MenuBar, type MenuBarProps } from "./menu/MenuBar.js";
export { focusFirstMenuItem, handleMenuBarKeyDown, menuBarKeyDown, menuItemsIn, menuKeyDown, } from "./menu/menuKeys.js";
export { SyncPill, type SyncPillProps, type SyncSituation } from "./menu/SyncPill.js";
export { PrivacyLine, type PrivacyLineProps } from "./PrivacyLine.js";
export { Toast, type ToastNotice, type ToastProps } from "./Toast.js";
export { FOCUS_RING, MOTION } from "./tokens.js";
//# sourceMappingURL=index.d.ts.map