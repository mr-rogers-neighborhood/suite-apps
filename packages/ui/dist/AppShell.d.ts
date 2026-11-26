import type { ComponentProps, ReactNode } from "react";
/**
 * The frame a pack draws its content in.
 *
 * Every desktop app had redrawn the same three regions: a top bar, an optional navigation column,
 * and the content itself. The differences were spacing and names, not shape. This owns the frame
 * and nothing else: the bar, the leading control, the trailing actions, the navigation and the
 * content all arrive as nodes, so the shell never learns an app's routes, its selection or its
 * data.
 *
 * The host still owns the window chrome and the cross-app `MenuBar`. A pack that already draws a
 * `MenuBar` passes it as `header`; the default header is the title bar a pack without one uses.
 *
 * Below the `md` breakpoint (768px) the navigation stops being a side column and becomes a
 * full-width region above the content. That is a layout change only: no state, no disclosure
 * control, and no hidden navigation on a narrow window. A pack whose phone layout is a drawer or a
 * bottom bar passes no `navigation` below `md` instead of paying for a stacked rail it never shows.
 *
 * The desktop column is `--shell-nav-width` (default `14rem`). A caller that lets a person
 * resize its navigator sets that variable on the shell instead of forking the frame.
 */
export interface AppShellOwnProps {
    /** The navigation region. Rendered inside a labelled `<nav>`. */
    readonly navigation?: ReactNode;
    /** The navigation landmark's accessible name. */
    readonly navigationLabel?: string;
    /** Extra classes for the navigation landmark: the rail's own surface, not a second frame. */
    readonly navigationClassName?: string;
    /** The content region. */
    readonly children: ReactNode;
}
/** The default bar: a title as the page's `<h1>`, with optional leading and trailing controls. */
export interface AppShellTitleHeader {
    /** The screen's title. Rendered as the page's one `<h1>`. */
    readonly title: ReactNode;
    /**
     * A leading control, typically a back button. The caller owns its accessible name.
     * Only meaningful with `title`.
     */
    readonly leading?: ReactNode;
    /** Trailing actions: primary buttons, a menu trigger, a search control. */
    readonly actions?: ReactNode;
    /** No custom bar; the title header is the bar. */
    readonly header?: undefined;
}
/** A caller-owned bar, such as the host's cross-app `MenuBar`. It owns its own heading order. */
export interface AppShellCustomHeader {
    /** The bar above the navigation and content. Replaces the default title header. */
    readonly header: ReactNode;
    /** Not used with `header`: the caller's bar owns the page's heading, if it draws one. */
    readonly title?: undefined;
    readonly leading?: undefined;
    readonly actions?: undefined;
}
export type AppShellProps = Omit<ComponentProps<"div">, "title" | "children"> & AppShellOwnProps & (AppShellTitleHeader | AppShellCustomHeader);
export declare function AppShell({ title, header, leading, actions, navigation, navigationLabel, navigationClassName, className, children, ...props }: AppShellProps): import("react").JSX.Element;
//# sourceMappingURL=AppShell.d.ts.map