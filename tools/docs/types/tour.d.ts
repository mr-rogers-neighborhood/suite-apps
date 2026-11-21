declare module "*.tour" {
  import type { MDXContent } from "mdx/types";

  const content: MDXContent;
  export default content;
}
