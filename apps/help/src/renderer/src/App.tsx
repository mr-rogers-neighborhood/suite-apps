import { Navigate, Route, Routes } from "react-router";

import { Explorer } from "./explorer/explorer";
import { HandbookPage } from "./handbook/handbook-page";
import { NotFound } from "./not-found";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/explore" replace />} />
      <Route path="/explore" element={<Explorer />} />
      <Route
        path="/start"
        element={<Navigate to="/explore?view=tours&tour=start&step=0" replace />}
      />
      <Route path="/tours" element={<Navigate to="/explore?view=tours" replace />} />
      <Route path="/handbook/*" element={<HandbookPage />} />
      <Route path="/handbook" element={<HandbookPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
