import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Authored notes are Markdown; raw HTML is not enabled. */
export function Note({ children }: { children: string }) {
  return (
    <div className="text-sm leading-6 text-fd-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-fd-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fd-foreground [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-fd-foreground [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-fd-muted [&_pre]:p-3 [&_pre]:text-xs [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
