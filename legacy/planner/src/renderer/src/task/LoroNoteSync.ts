import { Extension } from "@tiptap/react";
import { LoroSyncPlugin, type LoroSyncPluginProps } from "loro-prosemirror";

export type LoroNoteSyncOptions = {
  readonly doc: LoroSyncPluginProps["doc"] | null;
  readonly containerId: LoroSyncPluginProps["containerId"] | null;
  /** Kept distinct per note so an app-level undo manager can ignore structural writes. */
  readonly commitOrigin: string;
};

/**
 * Binds one Tiptap note editor to its Loro note container.
 *
 * `loro-prosemirror` is a ProseMirror plugin, not a Tiptap extension; Tiptap only sees plugins
 * that an extension returns from `addProseMirrorPlugins`. This is the same adapter Canvas uses,
 * minus cursors and the shared undo manager: Planner's notes are edited on one replica at a time.
 */
export const LoroNoteSync = Extension.create<LoroNoteSyncOptions>({
  name: "loroNoteSync",

  addOptions() {
    return {
      doc: null,
      containerId: null,
      commitOrigin: "note",
    };
  },

  addProseMirrorPlugins() {
    const { doc, containerId, commitOrigin } = this.options;
    if (doc === null || containerId === null || containerId === undefined) return [];
    return [LoroSyncPlugin({ doc, containerId, commitOrigin })];
  },
});
