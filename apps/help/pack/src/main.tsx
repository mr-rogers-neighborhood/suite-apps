import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";

import { App } from "@/App";
import "@/styles.css";

/**
 * The pack's entry.
 *
 * The desktop window serves Help from `suite-help://app/` with an SPA fallback, so it can keep
 * `BrowserRouter` and ordinary `/explore` and `/handbook/...` paths. A pack is served from
 * `suite-pack://<container>.help/index.html` and the host answers only files that exist, so the
 * pack keeps its routes in the hash: the entry file never changes, and a reload lands back on the
 * same view instead of asking the host for a page that was never written to disk.
 *
 * Everything else is the same mount as `src/renderer/src/main.tsx`: the same App, the same styles,
 * the same theme. Only the router differs.
 */
const root = document.getElementById("root");
if (root === null) throw new Error("Suite Help needs a #root element");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <ReactRouterProvider>
        <App />
      </ReactRouterProvider>
    </HashRouter>
  </StrictMode>,
);
