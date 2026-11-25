import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

import { SECTION_BASES } from "@/lib/handbook-pages";

/**
 * The handbook source, for the pack build.
 *
 * `legacy/help/src/renderer/src/lib/source.ts` is the desktop source and stays the
 * one wiring; this mirror exists only because `defineDocs.dir` is resolved
 * against the Vite root, and the pack build has `packs/help/pack` as its root
 * rather than `legacy/help/src/renderer`. Both names point at
 * `legacy/help/.generated/docs`, which `pnpm --dir legacy/help sync` writes.
 *
 * One source, two loaders: the User Handbook under `/handbook`, the Developer
 * Documentation under `/developer`. The audience index the reader filters with is
 * the generated `/data/docs.json`, not a list in this file.
 */
const docs = defineDocs({
  dir: "../../../legacy/help/.generated/docs",
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
