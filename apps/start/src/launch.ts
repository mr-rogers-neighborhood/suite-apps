import { defaultHost, type Host } from "./host.js";
import { launchIntent } from "./launchCommand.js";
import type { LaunchPlan } from "./route.js";

/**
 * Start a process and let go of it.
 *
 * Start is a launcher, so the child must outlive it: detached, no inherited
 * stdio, and released so Start's own event loop can exit. The executable comes
 * from an install record that discovery already checked for an absolute path;
 * the arguments come from a plan that already passed routing.
 *
 * The process goes through the host seam like every other one Start starts, so a
 * plan that names a host binary still runs on the host when Start is sandboxed.
 */
export function launchPlan(plan: LaunchPlan, host: Host = defaultHost()): number | null {
  const child = host.spawn(launchIntent(plan.app, plan.argv, { managed: true }));
  child.release();
  return child.pid;
}
