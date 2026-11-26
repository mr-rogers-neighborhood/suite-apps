import { Button } from "../Button.js";
import { cx } from "../cx.js";
import { EDGE, FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";

export interface PackRailAction {
  readonly label: string;
  readonly onSelect: () => void;
}

export interface PackRailScreenshot {
  readonly src: string;
  readonly alt: string;
}

export interface PackRailDetail {
  readonly label: string;
  readonly value: string;
}

export interface PackRailPack {
  readonly name: string;
  readonly description?: string;
  /** The pack card's icon, as a data URI. */
  readonly icon?: string;
  /** One line under the name: "Installed · 0.4.3", "Available · 0.4.4". */
  readonly status?: string;
  /** A warning about this build's ability to draw the pack. */
  readonly note?: string;
  readonly primary: {
    readonly label: string;
    readonly onSelect: () => void;
    readonly disabled?: boolean;
  };
  readonly actions?: readonly PackRailAction[];
  readonly screenshots?: readonly PackRailScreenshot[];
  /** The technical record: version, source, publisher, key, capabilities, signature. */
  readonly details: readonly PackRailDetail[];
}

export interface PackRailProps {
  readonly pack: PackRailPack | null;
  readonly onClose: () => void;
}

/**
 * A pack's page in the host's right rail.
 *
 * Choosing a pack in the catalogue shows this: what it is, what it looks like, and the one thing
 * to do with it. Everything a person does not need in order to decide — the publisher id, the key
 * fingerprint, the capability names, the archive source — sits behind **More details**, so the
 * face of the app never reads like an audit log.
 */
export function PackRail({ pack, onClose }: PackRailProps) {
  if (pack === null) return null;

  return (
    <aside
      aria-label={`${pack.name} details`}
      className={cx(
        "flex h-full w-full flex-col overflow-y-auto border-l",
        EDGE.hairline,
        SURFACE.base,
        INK.base,
      )}
    >
      <header className={cx("flex shrink-0 items-start gap-3 border-b p-4", EDGE.hairline)}>
        <span
          aria-hidden="true"
          className={cx(
            "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg",
            SURFACE.sunk,
          )}
        >
          {pack.icon === undefined ? (
            <span className={cx("text-[length:var(--text-title,15px)]", INK.muted)}>
              {pack.name.trim().slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <img src={pack.icon} alt="" className="h-7 w-7 object-contain" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[length:var(--text-title,15px)]">{pack.name}</h2>
          {pack.status === undefined ? null : (
            <p className={cx("mt-0.5 text-[length:var(--text-caption,11px)]", INK.muted)}>
              {pack.status}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className={cx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
            MOTION,
            FOCUS_RING,
          )}
        >
          <span aria-hidden="true">{"\u00d7"}</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {pack.description === undefined ? null : (
          <p className={cx("text-[length:var(--text-body,13px)] leading-relaxed", INK.muted)}>
            {pack.description}
          </p>
        )}

        {pack.note === undefined ? null : (
          <p
            className={cx(
              "rounded-md border p-3 text-[length:var(--text-label,12px)] leading-relaxed",
              EDGE.hairline,
              SURFACE.sunk,
              INK.muted,
            )}
          >
            {pack.note}
          </p>
        )}

        <Button
          variant="primary"
          onClick={pack.primary.onSelect}
          {...(pack.primary.disabled === true ? { disabled: true } : {})}
        >
          {pack.primary.label}
        </Button>

        {pack.screenshots === undefined || pack.screenshots.length === 0 ? null : (
          <section aria-label="Screenshots">
            <ul
              // A horizontal strip scrolls; axe requires the scroll container itself to be
              // reachable from the keyboard.
              tabIndex={0}
              className={cx("flex snap-x gap-2 overflow-x-auto pb-1", FOCUS_RING)}
            >
              {pack.screenshots.map((shot) => (
                <li key={shot.src} className="shrink-0 snap-start">
                  <img
                    src={shot.src}
                    alt={shot.alt}
                    className={cx("h-32 rounded-md border object-cover", EDGE.hairline)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {pack.actions === undefined || pack.actions.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {pack.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onSelect}
                className={cx(
                  "rounded-md border px-2.5 py-1.5 text-[length:var(--text-label,12px)] hover:bg-[var(--surface-sunk)]",
                  EDGE.hairline,
                  INK.muted,
                  MOTION,
                  FOCUS_RING,
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {pack.details.length === 0 ? null : (
          <details className={cx("group rounded-md border", EDGE.hairline)}>
            <summary
              className={cx(
                "cursor-pointer px-3 py-2 text-[length:var(--text-label,12px)]",
                INK.muted,
                FOCUS_RING,
              )}
            >
              More details
            </summary>
            <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 pb-3">
              {pack.details.map((detail) => (
                <div key={detail.label} className="contents">
                  <dt className={cx("text-[length:var(--text-caption,11px)]", INK.faint)}>
                    {detail.label}
                  </dt>
                  <dd
                    className={cx(
                      "min-w-0 break-words text-[length:var(--text-caption,11px)]",
                      INK.muted,
                    )}
                  >
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </aside>
  );
}
