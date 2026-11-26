import { Modal as SharedModal } from "@suite/ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

/**
 * Budget's dialog, on the shared one.
 *
 * `title`, `description`, `footer` and `width` stay the app-facing API. The shared `Modal`
 * supplies Radix's focus trap, Escape, outside press and focus return, plus the fixed
 * header/body/footer frame; this wrapper adds the visible heading and the Close control, which
 * stay Budget's own chrome. The callers do not change.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
  className,
}: ModalProps) {
  return (
    <SharedModal
      open={open}
      onClose={() => onOpenChange(false)}
      label={title}
      size={width}
      // The dynamic viewport keeps the panel on screen when a phone keyboard opens.
      // The body still scrolls; only the frame's height changes below `md`.
      className={`max-md:max-h-[calc(100dvh-1rem)] ${className ?? ""}`}
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-faint hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      }
      {...(description === undefined ? {} : { description })}
      {...(footer === undefined
        ? {}
        : {
            footer: (
              <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
            ),
          })}
    >
      {children}
    </SharedModal>
  );
}
