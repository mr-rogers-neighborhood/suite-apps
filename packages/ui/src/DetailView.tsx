import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";

/**
 * A detail pane: a title, a subtitle, actions, a body that scrolls, and an optional footer.
 *
 * The body is the only region that scrolls, so a toolbar the caller puts in `actions` and the
 * footer's Save/Cancel stay reachable while a long record moves behind them. The heading is an
 * `<h2>` because a detail pane normally sits inside an `AppShell` whose title is the page's
 * `<h1>`; a caller that uses this as the only content still gets a valid heading order.
 *
 * `footer` is outside the scroll container and stays at the bottom of the pane. The pane itself
 * fills its parent (`h-full`), so the host or the `AppShell` content region decides the height.
 */
export interface DetailViewProps extends Omit<ComponentProps<"section">, "title" | "children"> {
  /** The record's name. The pane's accessible name. */
  readonly title: ReactNode;
  /** One muted line under the title: a kind, a date, a count. */
  readonly subtitle?: ReactNode;
  /** Trailing controls in the header. */
  readonly actions?: ReactNode;
  /** A footer below the scrolling body, for the pane's primary actions. */
  readonly footer?: ReactNode;
  /** The scrolling body. */
  readonly children: ReactNode;
}

export function DetailView({
  title,
  subtitle,
  actions,
  footer,
  className,
  children,
  ...props
}: DetailViewProps) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      data-has-footer={footer === undefined ? undefined : "true"}
      className={cx("flex h-full min-h-0 flex-col", SURFACE.base, INK.base, className)}
      {...props}
    >
      <header
        className={cx("flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4", EDGE.hairline)}
      >
        <div className="min-w-0">
          <h2
            id={titleId}
            className="truncate text-[length:var(--text-title,15px)] font-semibold"
          >
            {title}
          </h2>
          {subtitle === undefined ? null : (
            <p className={cx("mt-1 text-[length:var(--text-label,12px)]", INK.muted)}>
              {subtitle}
            </p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer === undefined ? null : (
        <footer
          className={cx(
            "sticky bottom-0 z-10 shrink-0 border-t px-5 py-3",
            SURFACE.base,
            EDGE.hairline,
          )}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}
