import type { ComponentProps, ReactNode } from "react";
/**
 * The frame a pack draws its content in.
 *
 * Every desktop app had redrawn the same three regions: a title bar with a leading control and
 * trailing actions, an optional navigation column, and the content itself. The differences were
 * spacing and names, not shape. This owns the frame and nothing else: the leading control, the
 * trailing actions, the navigation and the content all arrive as nodes, so the shell never
 * learns an app's routes, its selection or its data.
 *
 * The host still owns the window chrome and the cross-app `MenuBar`. `AppShell` starts below
 * that bar and is the pack's own title/navigation/content frame; a pack that needs a different
 * frame keeps its own rather than bending this one.
 *
 * Below the `md` breakpoint (768px) the navigation stops being a side column and becomes a
 * full-width region above the content. That is a layout change only: no state, no disclosure
 * control, and no hidden navigation on a narrow window.
 *
 * The desktop column is `--shell-nav-width` (default `14rem`). A caller that lets a person
 * resize its navigator sets that variable on the shell instead of forking the frame.
 */
export interface AppShellProps extends Omit<ComponentProps<"div">, "title" | "children"> {
    /** The screen's title. Rendered as the page's one `<h1>`. */
    readonly title: ReactNode;
    /** A leading control, typically a back button. The caller owns its accessible name. */
    readonly leading?: ReactNode;
    /** Trailing actions: primary buttons, a menu trigger, a search control. */
    readonly actions?: ReactNode;
    /** The navigation region. Rendered inside a labelled `<nav>`. */
    readonly navigation?: ReactNode;
    /** The navigation landmark's accessible name. */
    readonly navigationLabel?: string;
    /** The content region. */
    readonly children: ReactNode;
}
export declare function AppShell({ title, leading, actions, navigation, navigationLabel, className, children, ...props }: AppShellProps): import("react").JSX.Element;
//# sourceMappingURL=AppShell.d.ts.map