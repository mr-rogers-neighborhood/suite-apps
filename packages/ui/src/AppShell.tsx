import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";

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

export type AppShellProps = Omit<ComponentProps<"div">, "title" | "children"> &
  AppShellOwnProps &
  (AppShellTitleHeader | AppShellCustomHeader);

export function AppShell({
  title,
  header,
  leading,
  actions,
  navigation,
  navigationLabel = "Navigation",
  navigationClassName,
  className,
  children,
  ...props
}: AppShellProps) {
  return (
    <div
      data-has-navigation={navigation === undefined ? undefined : "true"}
      data-has-header={header === undefined ? undefined : "custom"}
      className={cx("flex h-full min-h-0 flex-col", SURFACE.canvas, INK.base, className)}
      {...props}
    >
      {header === undefined ? (
        <header
          className={cx(
            "flex shrink-0 items-center gap-[var(--control-gap,0.5rem)] border-b px-5 py-3",
            SURFACE.base,
            EDGE.hairline,
          )}
        >
          {leading === undefined ? null : (
            <div className="flex shrink-0 items-center">{leading}</div>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[length:var(--text-title,15px)] font-semibold">
            {title}
          </h1>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      ) : (
        header
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {navigation === undefined ? null : (
          <nav
            aria-label={navigationLabel}
            className={cx(
              "shrink-0 overflow-y-auto border-b px-[var(--control-padding-x,0.75rem)] py-2 md:w-[var(--shell-nav-width,14rem)] md:border-b-0 md:border-r",
              EDGE.hairline,
              navigationClassName,
            )}
          >
            {navigation}
          </nav>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
