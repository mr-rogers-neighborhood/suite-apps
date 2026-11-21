import { compile } from "@mdx-js/mdx";
import { recmaCodeHike, remarkCodeHike } from "codehike/mdx";

/**
 * A walkthrough is compiled by Code Hike alone, outside the Fumadocs collection.
 *
 * Fumadocs compiles collection pages with `unstable_runtimeOutputs`, and its
 * `remarkHeading`/`remarkStructure` plugins cannot read Code Hike's JSX
 * attribute with an empty `value` (the AST lives in `data.estree`). Keeping
 * walkthroughs out of the collection avoids that interaction entirely.
 */
const chConfig = {
  components: { code: "Code" },
  syntaxHighlighting: { theme: "github-dark" },
};

export default async function tourLoader(source) {
  const callback = this.async();
  try {
    const compiled = await compile(
      { value: source, path: this.resourcePath },
      {
        remarkPlugins: [[remarkCodeHike, chConfig]],
        recmaPlugins: [[recmaCodeHike, chConfig]],
        outputFormat: "program",
      },
    );
    callback(null, String(compiled));
  } catch (error) {
    callback(error);
  }
}
