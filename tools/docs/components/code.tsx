import { Pre, highlight, type RawCode } from "codehike/code";

/**
 * The component Code Hike writes into MDX when the config names `Code`.
 * This is a server component: `highlight` runs at build time.
 */
export async function Code({ codeblock }: { codeblock: RawCode }) {
  const highlighted = await highlight(codeblock, "github-dark");
  return (
    <Pre
      code={highlighted}
      className="my-4 max-h-[32rem] overflow-auto rounded-lg border border-fd-border bg-[#0d1117] p-4 text-sm"
    />
  );
}
