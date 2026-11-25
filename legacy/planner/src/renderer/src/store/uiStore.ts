import { type DateKey, todayKey } from "@suite/planner-core";
import { create } from "zustand";

import type { ViewId } from "../app/views";

type UiState = {
  view: ViewId;
  selectedDate: DateKey;
  selectedTaskId: string | null;
  captureSignal: number;
  notice: string | null;
  setView: (view: ViewId) => void;
  setSelectedDate: (date: DateKey) => void;
  selectTask: (id: string | null) => void;
  focusCapture: () => void;
  setNotice: (notice: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  view: "today",
  selectedDate: todayKey(),
  selectedTaskId: null,
  captureSignal: 0,
  notice: null,
  setView: (view) => set({ view }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  focusCapture: () => set((state) => ({ captureSignal: state.captureSignal + 1 })),
  setNotice: (notice) => set({ notice }),
}));
