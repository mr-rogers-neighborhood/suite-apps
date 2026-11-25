import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";

/**
 * A dialog surface: the backdrop, the focus trap, Escape, and the ARIA.
 *
 * The behaviour is Radix Dialog's, not another hand-written focus trap. It moves focus in on
 * open, returns it on close, wraps Tab inside the panel, closes on Escape and on a press
 * outside, and marks the rest of the page inert. Those are the parts every hand-written modal
 * gets subtly wrong, and they are exactly what the chosen primitive already owns.
 *
 * The public API stays the app-facing one: `open`, `onClose`, `label`, `size`. Radix's
 * `onOpenChange` is only the bridge; a caller never learns that the implementation changed.
 *
 * A bare panel (no slots) is unchanged from the first version: `children` get the padding and
 * the panel scrolls. Passing `header`, `description` or `footer` switches to a fixed frame —
 * header and footer stay put while `children` scroll between them — so an app keeps its visible
 * title, description and close control caller-composed rather than taught to the primitive.
 */
export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Read aloud on open, and the panel's accessible name. */
  readonly label: string;
  /**
   * A fixed region above the scrolling body. A caller puts its visible heading and close
   * control here; the primitive does not add a title of its own.
   */
  readonly header?: ReactNode;
  /** Shown under the header and announced as the dialog's description. */
  readonly description?: ReactNode;
  /** A fixed region below the scrolling body: the caller's actions. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** `sm` fits a confirm; `md` a form; `lg` a wizard step; `xl` a wide import or table. */
  readonly size?: "sm" | "md" | "lg" | "xl";
  readonly className?: string;
}

const SIZES = {
  sm: "w-[min(400px,calc(100vw-2rem))]",
  md: "w-[min(560px,calc(100vw-2rem))]",
  lg: "w-[min(760px,calc(100vw-2rem))]",
  xl: "w-[min(896px,calc(100vw-2rem))]",
} as const;

export function Modal({
  open,
  onClose,
  label,
  header,
  description,
  footer,
  children,
  size = "md",
  className,
}: ModalProps) {
  // Radix restores focus on close, but capture the opener explicitly as well: a caller may
  // unmount the dialog in the same render that closes it, and the explicit target survives
  // that. This is the one behaviour the package owned before Radix and still promises.
  const restoreTo = useRef<HTMLElement | null>(null);
  const framed = header !== undefined || description !== undefined || footer !== undefined;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // A caller's `onClose` is the only close event it cares about. Opening is controlled
        // by `open`; Radix never asks to open a dialog from inside one.
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        {/* The scrim is the theme's ink at 30%, not `black`: a preset can change what "dimmed"
            means without a component holding a colour. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          // A visible heading belongs to the caller. The hidden title names the dialog for
          // assistive technology; the description, when given, is Radix's to wire up.
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
          aria-modal="true"
          onOpenAutoFocus={() => {
            restoreTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreTo.current?.isConnected === true) restoreTo.current.focus();
          }}
          className={cx(
            "fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-4rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border shadow-[var(--shadow-2xl)] outline-none",
            SURFACE.base,
            EDGE.hairline,
            INK.base,
            SIZES[size],
            framed ? "flex flex-col overflow-hidden" : "overflow-y-auto p-5",
            className,
          )}
        >
          {/* A span, not Radix's default h2: the caller's visible heading is the only heading
              the dialog should add to the document. Radix still uses this text as the name. */}
          <DialogPrimitive.Title asChild>
            <span className="sr-only">{label}</span>
          </DialogPrimitive.Title>
          {framed ? (
            <>
              {header === undefined && description === undefined ? null : (
                <div className={cx("shrink-0 border-b px-5 py-4", EDGE.hairline)}>
                  {header}
                  {description === undefined ? null : (
                    <DialogPrimitive.Description
                      className={cx(
                        header === undefined ? undefined : "mt-1",
                        "text-[length:var(--text-label,12px)] leading-relaxed",
                        INK.muted,
                      )}
                    >
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
              {footer === undefined ? null : (
                <div className={cx("shrink-0 border-t px-5 py-3", EDGE.hairline)}>{footer}</div>
              )}
            </>
          ) : (
            children
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
