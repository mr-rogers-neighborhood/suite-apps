import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";

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

export function AppShell({
  title,
  leading,
  actions,
  navigation,
  navigationLabel = "Navigation",
  className,
  children,
  ...props
}: AppShellProps) {
  return (
    <div
      data-has-navigation={navigation === undefined ? undefined : "true"}
      className={cx("flex h-full min-h-0 flex-col", SURFACE.canvas, INK.base, className)}
      {...props}
    >
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

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {navigation === undefined ? null : (
          <nav
            aria-label={navigationLabel}
            className={cx(
              "shrink-0 overflow-y-auto border-b px-[var(--control-padding-x,0.75rem)] py-2 md:w-56 md:border-b-0 md:border-r",
              EDGE.hairline,
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
