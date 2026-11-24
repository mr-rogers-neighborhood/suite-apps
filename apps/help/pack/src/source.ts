import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

/**
 * The handbook source, for the pack build.
 *
 * `apps/help/src/renderer/src/lib/source.ts` is the desktop source and stays the one wiring; this
 * mirror exists only because `defineDocs.dir` is resolved against the Vite root, and the pack build
 * has `apps/help/pack` as its root rather than `apps/help/src/renderer`. Both names point at
 * `apps/help/.generated/docs`, which `pnpm --dir apps/help sync` writes.
 */
const docs = defineDocs({
  dir: "../.generated/docs",
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
