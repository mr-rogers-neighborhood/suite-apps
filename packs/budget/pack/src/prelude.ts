import { type BudgetPackHost, createBudgetPack } from "./bridge";

/**
 * Install Budget's bridge as `window.suiteBudget`.
 *
 * The container supplies `window.suite` (documents, files, info and lifecycle).
 * This module runs before the app's own entry so the renderer finds the bridge
 * on its first render. It is deliberately the only side effect: the library in
 * `bridge.ts` is what the tests call.
 */
const suite = (globalThis as { suite?: BudgetPackHost }).suite;
const pack = createBudgetPack({ host: suite ?? {} });

Object.assign(globalThis, { suiteBudget: pack.bridge });

// The host tells a document app which document to open, or that this tab is a
// create request. Budget keeps the promise for the renderer; the prelude is the
// only place that sees the raw `window.suite` before React mounts.
const launch = (
  suite as
    | {
        readonly launch?: () => Promise<{
          readonly kind: string;
          readonly documentId?: string;
          readonly url?: string;
        }>;
      }
    | undefined
)?.launch?.();
if (launch !== undefined) Object.assign(globalThis, { __suiteBudgetLaunch: launch });

/**
 * A device assertion handle, in the same spirit as the shell's dev globals.
 *
 * It reports the document id, flushes a boundary on demand and exposes the
 * sentences the pack would show. It never exposes the document's contents.
 */
Object.assign(globalThis, {
  __suiteBudgetPack: {
    documentId: pack.documentId,
    flush: pack.flush,
    notices: pack.notices,
    dispose: pack.dispose,
  },
});
