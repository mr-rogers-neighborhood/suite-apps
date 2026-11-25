import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

import { SECTION_BASES } from "@/lib/handbook-pages";

/**
 * The handbook source.
 *
 * `sync-docs` writes the repository's Markdown into `packs/help/.generated/docs`
 * with the frontmatter and `_meta.json` files Fumadocs reads. The macro is
 * compiled by `fumadocs-mdx/vite`, so the page tree and the MDX bodies are baked
 * into the static bundle: no server, no request for content.
 *
 * There is one source and two loaders over it. `baseUrl` is the only difference:
 * the User Handbook opens under `/handbook`, the Developer Documentation under
 * `/developer`. The generated `/data/docs.json` says which page belongs where, so
 * neither loader keeps a list of its own.
 */
const docs = defineDocs({
  // Relative to this renderer root (`packs/help/pack/src/renderer`), which both the desktop
  // shell and the pack use; the generated tree lives at the Help package root.
  dir: "../../../.generated/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export const sources = {
  user: loader({ baseUrl: SECTION_BASES.user, source: docs.toFumadocsSource() }),
  developer: loader({ baseUrl: SECTION_BASES.developer, source: docs.toFumadocsSource() }),
};
