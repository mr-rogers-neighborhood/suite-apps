import type { ComponentProps, ReactNode } from "react";
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
export declare function DetailView({ title, subtitle, actions, footer, className, children, ...props }: DetailViewProps): import("react").JSX.Element;
//# sourceMappingURL=DetailView.d.ts.map