/**
 * A composed tour: it crosses module, file, symbol and walk targets so the
 * reader can see the same seam at different altitudes.
 *
 * Normal walks are already tours; they do not need a file like this one.
 */
export default {
  id: "suite-in-one-sitting",
  title: "The suite in one sitting",
  summary: "One seam from the shared contract to the document layer, at four altitudes.",
  order: 50,
  steps: [
    {
      target: { kind: "module", id: "packages/contracts" },
      callout: "Start with the shared language. It has no UI and no document format.",
    },
    {
      target: { kind: "file", id: "packages/contracts/src/appManifest.ts" },
      callout: "The manifest is a file, so the next level is its declarations.",
    },
    {
      target: {
        kind: "symbol",
        id: "packages/contracts/src/appManifest.ts#suiteAppManifestSchema",
      },
      callout: "This schema is the only place an app declaration is validated.",
    },
    {
      target: { kind: "walk", id: "start", step: 0 },
      callout: "Now follow the handoff as a curated path.",
    },
    {
      target: { kind: "symbol", id: "apps/canvas/src/App.tsx#App", level: "file" },
      callout: "The renderer boots without reading the document format; the bridge supplies it.",
    },
    {
      target: { kind: "module", id: "apps/canvas/packages/graph" },
      callout: "The document layer is a separate package, so a component never reaches Loro.",
    },
    {
      target: { kind: "doc", path: "docs/reference/decisions.md" },
      callout: "The durable rule lives in the decisions page.",
    },
  ],
};
