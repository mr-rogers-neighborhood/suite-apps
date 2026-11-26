import { Link } from "react-router";

import { type Audience, otherAudience, SECTION_BASES } from "@/lib/handbook-pages";

/**
 * The switch between the two sections, in the reader and in the explorer.
 *
 * It is the only control that crosses the split, and it names the section it goes
 * to rather than a generic "switch docs": a developer reading the code explorer
 * sees the way out to the handbook, and a reader in the handbook sees the way in
 * to the documentation for the code.
 */
export function SectionSwitch({ audience }: { audience: Audience }) {
  const target = otherAudience(audience);
  const prompt = audience === "user" ? "Developer?" : "Not a developer?";
  const action =
    target === "user" ? "View the user handbook" : "Switch to the developer documentation";

  return (
    <Link
      to={SECTION_BASES[target]}
      aria-label={`${prompt} ${action}`}
      className="rounded-lg border border-fd-border px-2.5 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
    >
      <span className="hidden sm:inline">{prompt} </span>
      <span className="hidden font-medium text-fd-foreground sm:inline">{action}</span>
      {/* A phone header has room for two words, not the whole sentence. The accessible name
          above keeps the full prompt for a screen reader. */}
      <span className="font-medium text-fd-foreground sm:hidden">
        {target === "user" ? "User handbook" : "Developer docs"}
      </span>
    </Link>
  );
}
