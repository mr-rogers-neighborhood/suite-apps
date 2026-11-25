import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Suite Help needs a #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ReactRouterProvider>
        <App />
      </ReactRouterProvider>
    </BrowserRouter>
  </StrictMode>,
);
