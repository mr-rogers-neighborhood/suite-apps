import { Navigate, Route, Routes } from "react-router";

import { Explorer } from "./explorer/explorer";
import { DocsSection } from "./handbook/docs-section";
import { NotFound } from "./not-found";

/**
 * Suite Help's routes.
 *
 * `/handbook` is the User Handbook and `/developer` is the Developer
 * Documentation, over the one generated docs tree. The root opens the handbook,
 * because Help is a reader first and a code explorer second.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/handbook" replace />} />
      <Route path="/explore" element={<Explorer />} />
      <Route
        path="/start"
        element={<Navigate to="/explore?view=tours&tour=start&step=0" replace />}
      />
      <Route path="/tours" element={<Navigate to="/explore?view=tours" replace />} />
      <Route path="/handbook/*" element={<DocsSection audience="user" />} />
      <Route path="/handbook" element={<DocsSection audience="user" />} />
      <Route path="/developer/*" element={<DocsSection audience="developer" />} />
      <Route path="/developer" element={<DocsSection audience="developer" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
