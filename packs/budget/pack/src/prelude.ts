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

if (suite?.launch !== undefined) {
  Object.assign(globalThis, { __suiteBudgetLaunch: suite.launch() });
}

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
