import { storeLocalAttachment } from "../../src/editor/attachmentNode";
import { type CanvasPackHost, createCanvasPack } from "./bridge";

/**
 * Install Canvas's bridge as `window.suiteDesktop`.
 *
 * The host supplies `window.suite` (documents, files, info and lifecycle). This module runs before
 * the app's own entry so the renderer finds the bridge on its first render — and finds the *same*
 * bridge it already expects from the Electron shell. It is deliberately the only side effect: the
 * adapter next door is what the tests call.
 *
 * Imported images go through the renderer's own attachment store, so an exported `.canvas` that
 * carries its pixels draws them again after a re-import.
 */
const suite = (globalThis as { suite?: CanvasPackHost }).suite;
const pack = createCanvasPack({
  host: suite ?? {},
  storeAttachment: storeLocalAttachment,
  ...(suite?.reload !== undefined ? { reload: suite.reload } : {}),
});

Object.assign(globalThis, { suiteDesktop: pack.bridge });

if (suite?.launch !== undefined) {
  Object.assign(globalThis, { __suiteCanvasLaunch: suite.launch() });
}

/**
 * A device assertion handle, in the same spirit as the shell's dev globals.
 *
 * It reports the host document id, flushes a boundary on demand and exposes the sentences the pack
 * would show. It never exposes the document's contents.
 */
Object.assign(globalThis, {
  __suiteCanvasPack: {
    documentId: pack.documentId,
    flush: pack.flush,
    reveal: pack.reveal,
    importFolder: pack.importFolder,
    libraryChanges: pack.libraryChanges,
    notices: pack.notices,
    dispose: pack.dispose,
  },
});
