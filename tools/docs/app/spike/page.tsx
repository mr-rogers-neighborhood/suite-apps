"use client";

import { parseRoot } from "codehike/blocks";
import { Pre, type HighlightedCode } from "codehike/code";
import { Selection, Selectable, SelectionProvider } from "codehike/utils/selection";
import Content from "./content.tour";

type Step = {
  title?: string;
  children: React.ReactNode;
  code: HighlightedCode;
};

export default function Page() {
  const { steps } = parseRoot(Content) as { steps: Step[] };

  return (
    <SelectionProvider className="mx-auto flex max-w-6xl gap-8 p-8">
      <div className="min-w-0 flex-1 pb-[60vh]">
        {steps.map((step, index) => (
          <Selectable
            key={index}
            index={index}
            selectOn={["click", "scroll"]}
            className="mb-40 rounded-lg border-l-4 border-zinc-700 px-5 py-3 data-[selected=true]:border-blue-400"
          >
            <h2 className="mb-2 text-xl font-semibold">{step.title}</h2>
            <div>{step.children}</div>
          </Selectable>
        ))}
      </div>
      <div className="w-[42vw] max-w-xl">
        <div className="sticky top-8 overflow-auto">
          <Selection
            from={steps.map((step, index) => (
              <Code key={index} codeblock={step.code} />
            ))}
          />
        </div>
      </div>
    </SelectionProvider>
  );
}

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return (
    <Pre
      code={codeblock}
      className="max-h-[80vh] min-h-[28rem] overflow-auto rounded-lg border border-zinc-700 bg-[#0d1117] p-4 text-sm"
    />
  );
}
