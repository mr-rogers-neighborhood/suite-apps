import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

/**
 * The handbook source.
 *
 * `sync-docs` writes the repository's Markdown into `.generated/docs` with the
 * frontmatter and `_meta.json` files Fumadocs reads. The macro is compiled by
 * `fumadocs-mdx/vite`, so the page tree and the MDX bodies are baked into the
 * static bundle: no server, no request for content.
 */
const docs = defineDocs({
  // Relative to the renderer root (`src/renderer`); the generated tree lives at the app root.
  dir: "../../.generated/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: "/handbook",
  source: docs.toFumadocsSource(),
});
