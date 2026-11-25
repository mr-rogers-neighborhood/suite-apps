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
 * 3. Publish the token layers on the view that hosts the component. A pack receives the colour
 *    roles from its host today; the type, density, radius, shadow and motion layers are
 *    `scaleVariables(density)` from `@suite/theme`. `@suite/ui` falls back to the values that
 *    shipped when a host has not published them yet.
 *
 * 4. React 19 is a peer, not a dependency.
 */
export { AppMark } from "./AppMark.js";
export { Button } from "./Button.js";
export { cx } from "./cx.js";
export { EmptyState } from "./EmptyState.js";
export { Field } from "./Field.js";
export { IconButton } from "./IconButton.js";
export { Launch } from "./Launch.js";
export { Modal } from "./Modal.js";
export { MenuBar } from "./menu/MenuBar.js";
export { focusFirstMenuItem, handleMenuBarKeyDown, menuBarKeyDown, menuItemsIn, menuKeyDown, } from "./menu/menuKeys.js";
export { SyncPill } from "./menu/SyncPill.js";
export { PrivacyLine } from "./PrivacyLine.js";
export { Toast } from "./Toast.js";
export { FOCUS_RING, MOTION } from "./tokens.js";
//# sourceMappingURL=index.js.map