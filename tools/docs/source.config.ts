import { recmaCodeHike, remarkCodeHike, type CodeHikeConfig } from "codehike/mdx";
import { defineConfig } from "fumadocs-mdx/config";

/**
 * Spike configuration.
 *
 * Code Hike must run *after* Fumadocs' own remark plugins. Prepending it makes
 * `remarkStructure` and `remarkHeading` see Code Hike's JSX attribute with an
 * empty `value` (the AST is in `data.estree`), which fails the MDX parse with
 * "JSX attributes must only be assigned a non-empty expression".
 *
 * `ignoreCode` leaves Mermaid diagrams to Fumadocs/Shiki.
 */
const chConfig: CodeHikeConfig = {
  components: {
    code: "Code",
  },
  ignoreCode: (codeblock) => codeblock.lang === "mermaid",
};

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [...v, [remarkCodeHike, chConfig]],
    recmaPlugins: [[recmaCodeHike, chConfig]],
  },
});
