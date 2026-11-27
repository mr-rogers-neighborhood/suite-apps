import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Whether this data root has seen the first-run wizard.
 *
 * A missing, unreadable or older record is a first run: the worst a repeated wizard can do is
 * ask again. A completed record is a small file beside the host's other profile choices, so a
 * fresh launch is one read and no write.
 *
 * A root that already has a space document or a Screen was used before this build knew about
 * onboarding. It is an upgrade, not a new person, so it does not get the wizard; counting
 * `theme.json` would be wrong, because the wizard writes it before the person finishes.
 */
const ONBOARDING_FILENAME = "onboarding.json";
const ONBOARDING_VERSION = 1;

interface OnboardingRecord {
  readonly version: number;
  readonly completed: boolean;
  readonly completedAt: string | null;
}

async function hasExistingProfile(dataRoot: string): Promise<boolean> {
  try {
    await access(join(dataRoot, "spaces.loro"));
    return true;
  } catch {
    // The space document is written when the first tab changes, not at open.
  }
  try {
    const screens = await readdir(join(dataRoot, "screens"));
    return screens.some((name) => name.endsWith(".loro"));
  } catch {
    return false;
  }
}

export async function isFirstRun(dataRoot: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(join(dataRoot, ONBOARDING_FILENAME), "utf8")) as {
      version?: unknown;
      completed?: unknown;
    };
    if (raw.version === ONBOARDING_VERSION && raw.completed === true) return false;
  } catch {
    // A missing or unreadable record is not an answer; the profile check below decides.
  }
  return !(await hasExistingProfile(dataRoot));
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

/**
 * One-time host data migrations.
 *
 * Content is a bad migration marker: a person may re-add what a migration removed. A small
 * record beside the profile says which migrations ran, so an upgrade happens once and a
 * deliberate choice afterwards is left alone.
 */
const MIGRATIONS_FILENAME = "migrations.json";
const MIGRATIONS_VERSION = 1;
const HOME_APPS_MIGRATION = "home-apps-removed";

interface MigrationsRecord {
  readonly version: number;
  readonly completed: readonly string[];
}

async function readMigrations(dataRoot: string): Promise<readonly string[]> {
  try {
    const raw = JSON.parse(await readFile(join(dataRoot, MIGRATIONS_FILENAME), "utf8")) as {
      version?: unknown;
      completed?: unknown;
    };
    if (raw.version !== MIGRATIONS_VERSION || !Array.isArray(raw.completed)) return [];
    return raw.completed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export async function needsHomeAppsMigration(dataRoot: string): Promise<boolean> {
  return !(await readMigrations(dataRoot)).includes(HOME_APPS_MIGRATION);
}

export async function recordHomeAppsMigration(dataRoot: string): Promise<void> {
  const completed = [...new Set([...(await readMigrations(dataRoot)), HOME_APPS_MIGRATION])];
  await mkdir(dataRoot, { recursive: true });
  const path = join(dataRoot, MIGRATIONS_FILENAME);
  const record: MigrationsRecord = { version: MIGRATIONS_VERSION, completed };
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, path);
}
