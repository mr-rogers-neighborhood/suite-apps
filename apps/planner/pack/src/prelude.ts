import { createPlannerPack, type PlannerPackHost } from "./bridge";

/**
 * Install Planner's bridge as `window.suitePlanner`.
 *
 * The host supplies `window.suite` (documents, files, info and lifecycle). This module runs before
 * the app's own entry so the renderer finds the bridge on its first render. It is deliberately the
 * only side effect: the adapter next door is what the tests call.
 */
const suite = (globalThis as { suite?: PlannerPackHost }).suite;
const pack = createPlannerPack({ host: suite ?? {} });

Object.assign(globalThis, { suitePlanner: pack.bridge });

// The host routes a reminder's link to this tab and hands the launch context to
// the pack once it is running. The renderer waits on this promise rather than
// parsing a URL out of its own location.
if (suite?.launch !== undefined) {
  Object.assign(globalThis, { __suitePlannerLaunch: suite.launch() });
}

/**
 * A device assertion handle, in the same spirit as the shell's dev globals.
 *
 * It reports the host document id and flushes a boundary on demand. It never exposes the
 * document's contents.
 */
Object.assign(globalThis, {
  __suitePlannerPack: {
    documentId: pack.documentId,
    flush: pack.flush,
    dispose: pack.dispose,
  },
});
