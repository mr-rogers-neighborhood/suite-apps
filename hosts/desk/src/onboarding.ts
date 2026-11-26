import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Whether this data root has seen the first-run wizard.
 *
 * A missing, unreadable or older record is a first run: the worst a repeated wizard can do is
 * ask again. A completed record is a small file beside the host's other profile choices, so a
 * fresh launch is one read and no write.
 */
const ONBOARDING_FILENAME = "onboarding.json";
const ONBOARDING_VERSION = 1;

interface OnboardingRecord {
  readonly version: number;
  readonly completed: boolean;
  readonly completedAt: string | null;
}

export async function isFirstRun(dataRoot: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(join(dataRoot, ONBOARDING_FILENAME), "utf8")) as {
      version?: unknown;
      completed?: unknown;
    };
    return raw.version !== ONBOARDING_VERSION || raw.completed !== true;
  } catch {
    return true;
  }
}

export async function completeOnboarding(dataRoot: string): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  const path = join(dataRoot, ONBOARDING_FILENAME);
  const record: OnboardingRecord = {
    version: ONBOARDING_VERSION,
    completed: true,
    completedAt: new Date().toISOString(),
  };
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, path);
}
