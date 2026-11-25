/**
 * A composed tour. It crosses module, file, symbol, tour and doc targets so the
 * reader can see one seam at different altitudes.
 *
 * Linear tours stay MDX; a composed tour needs a file like this one.
 */
export default {
  id: "suite-in-one-sitting",
  audience: "developer",
  title: "The suite in one sitting",
  summary: "One seam from the shared contract to the document layer, at four altitudes.",
  intro:
    "This tour is a map, not a manual. It follows one boundary from the smallest shared contract to the package that owns the document, and it changes altitude deliberately: a module, a file, one declaration, then a curated path. Use it when you want to see how the pieces fit before opening any one of them in depth.",
  order: 60,
  steps: [
    {
      kind: "interlude",
      title: "Start at the boundary",
      body: "The first three stops are the same idea at three altitudes: the package, the file and the declaration that makes the boundary real. Nothing here reads a document or starts a process.",
    },
    {
      kind: "node",
      target: { kind: "module", id: "packages/contracts" },
      note: "Start with the shared language. It has no UI and no document format.",
    },
    {
      kind: "node",
      target: { kind: "file", id: "packages/contracts/src/appManifest.ts" },
      note: "The manifest is a file, so the next level is its declarations.",
    },
    {
      kind: "node",
      target: {
        kind: "symbol",
        id: "packages/contracts/src/appManifest.ts#suiteAppManifestSchema",
      },
      note: "This schema is the only place an app declaration is validated.",
      overlay: {
        title: "Why the manifest has no binary",
        body: "A manifest says what an app is, never which executable to run. The install record owns the executable, so a tampered manifest cannot redirect a launch.",
      },
    },
    {
      kind: "node",
      target: { kind: "tour", id: "start", step: 0 },
      note: "Now follow the handoff as a curated path.",
    },
    {
      kind: "node",
      target: { kind: "symbol", id: "packs/canvas/src/App.tsx#App", level: "file" },
      note: "The renderer boots without reading the document format; the bridge supplies it.",
    },
    {
      kind: "interlude",
      title: "The document layer",
      body: "The app shell is not the document layer. The next stop is the package that owns the schema, the typed writes and the file envelope.",
    },
    {
      kind: "node",
      target: { kind: "module", id: "packs/canvas/packages/graph" },
      note: "The document layer is a separate package, so a component never reaches Loro.",
    },
    {
      kind: "node",
      target: { kind: "doc", path: "docs/reference/decisions.md" },
      note: "The durable rule lives in the decisions page.",
    },
  ],
};
