import type { KeyValueStore } from "@suite/go";

/**
 * The shell's open-app tabs (Orca pattern).
 *
 * One tab per app, not per document: focusing an app that is already open must
 * focus its tab rather than open a second one. The model is pure so the routing
 * rules are tested without a WebView; `createTabStore` is the only part that
 * persists anything.
 *
 * The container still knows nothing about a domain: a tab is a module id the
 * shell was handed, and every rule here is the same for every id.
 */

export interface TabState {
  /** Open module ids, in the order they were first opened. */
  readonly tabs: readonly string[];
  /** The module whose tab is showing, or null when Home is. */
  readonly active: string | null;
}

export interface TabStore {
  read(): Promise<TabState>;
  write(state: TabState): Promise<void>;
}

const TAB_KEY = "tabs";
const TAB_VERSION = 1;

export const EMPTY_TABS: TabState = { tabs: [], active: null };

function normalise(state: TabState): TabState {
  const tabs: string[] = [];
  for (const id of state.tabs) {
    if (id.length === 0 || tabs.includes(id)) continue;
    tabs.push(id);
  }
  const active = state.active !== null && tabs.includes(state.active) ? state.active : null;
  return { tabs, active };
}

/** Focus an app, opening its tab only when it is not already open. */
export function openTab(state: TabState, moduleId: string): TabState {
  if (moduleId.length === 0) return normalise(state);
  const tabs = state.tabs.includes(moduleId) ? state.tabs : [...state.tabs, moduleId];
  return { tabs, active: moduleId };
}

/** Focus an existing tab. An unknown id is ignored rather than opened. */
export function focusTab(state: TabState, moduleId: string): TabState {
  return state.tabs.includes(moduleId) ? { ...state, active: moduleId } : state;
}

/** Close one tab. The active tab moves to its left neighbour, then right, then Home. */
export function closeTab(state: TabState, moduleId: string): TabState {
  const index = state.tabs.indexOf(moduleId);
  if (index === -1) return state;
  const tabs = state.tabs.filter((id) => id !== moduleId);
  if (state.active !== moduleId) return { tabs, active: state.active };
  const next = tabs[index - 1] ?? tabs[index] ?? null;
  return { tabs, active: next };
}

/** Remove every tab for a pack that was uninstalled. */
export function removeTabs(state: TabState, moduleIds: readonly string[]): TabState {
  const removed = new Set(moduleIds);
  const tabs = state.tabs.filter((id) => !removed.has(id));
  // If the active tab went, fall back to the nearest surviving tab or Home.
  const active =
    state.active !== null && tabs.includes(state.active) ? state.active : (tabs.at(-1) ?? null);
  return { tabs, active };
}

/** Leave a tab for Home without closing it. */
export function showHome(state: TabState): TabState {
  return { ...state, active: null };
}

/** Drop tabs whose module is no longer available, preserving the rest. */
export function retainTabs(state: TabState, available: readonly string[]): TabState {
  const known = new Set(available);
  return normalise({
    tabs: state.tabs.filter((id) => known.has(id)),
    active: state.active !== null && known.has(state.active) ? state.active : null,
  });
}

function parse(raw: string | null): TabState {
  if (raw === null || raw.length === 0) return EMPTY_TABS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_TABS;
    const record = value as Record<string, unknown>;
    if (record.version !== TAB_VERSION || !Array.isArray(record.tabs)) return EMPTY_TABS;
    const tabs = record.tabs.filter((id): id is string => typeof id === "string");
    const active = typeof record.active === "string" ? record.active : null;
    return normalise({ tabs, active });
  } catch {
    // A strip that will not parse is an empty strip, never a start-up failure.
    return EMPTY_TABS;
  }
}

export function createTabStore(store: KeyValueStore): TabStore {
  return {
    async read() {
      return parse(await store.get(TAB_KEY));
    },
    async write(state) {
      await store.set(
        TAB_KEY,
        JSON.stringify({ version: TAB_VERSION, tabs: state.tabs, active: state.active }),
      );
    },
  };
}
