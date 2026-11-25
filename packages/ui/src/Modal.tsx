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
 */
export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Read aloud on open, and the panel's accessible name. */
  readonly label: string;
  readonly children: ReactNode;
  /** `sm` fits a confirm; `md` a form; `lg` a wizard step. */
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const SIZES = {
  sm: "w-[min(400px,calc(100vw-2rem))]",
  md: "w-[min(560px,calc(100vw-2rem))]",
  lg: "w-[min(760px,calc(100vw-2rem))]",
} as const;

export function Modal({ open, onClose, label, children, size = "md", className }: ModalProps) {
  // Radix restores focus on close, but capture the opener explicitly as well: a caller may
  // unmount the dialog in the same render that closes it, and the explicit target survives
  // that. This is the one behaviour the package owned before Radix and still promises.
  const restoreTo = useRef<HTMLElement | null>(null);

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
          // A visible heading belongs to the caller. The hidden title is what names the
          // dialog for assistive technology; there is no description unless the caller adds one.
          aria-describedby={undefined}
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
            "fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-4rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-5 shadow-[var(--shadow-2xl)] outline-none",
            SURFACE.base,
            EDGE.hairline,
            INK.base,
            SIZES[size],
            className,
          )}
        >
          {/* A span, not Radix's default h2: the caller's visible heading is the only heading
              the dialog should add to the document. Radix still uses this text as the name. */}
          <DialogPrimitive.Title asChild>
            <span className="sr-only">{label}</span>
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
