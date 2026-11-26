import type { PlannerRendererBridge } from "./bridge";

declare global {
  interface Window {
    suitePlanner?: PlannerRendererBridge;
  }
}
