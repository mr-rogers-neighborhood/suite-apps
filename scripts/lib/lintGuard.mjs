/**
 * Reading `biome check`'s own report.
 *
 * A lint that inspected no files is neither a pass nor a finding. It means the
 * invocation never reached the code: the working directory sat inside a path
 * the app's `files.includes` excludes, or the VCS ignore file swallowed
 * everything. Biome still exits non-zero for that, so the row goes red with a
 * message that reads like a code problem (issue #425).
 *
 * These helpers read the one line biome prints for every run — `Checked N files`
 * — and the note it prints when every given path was ignored, so
 * `scripts/lint.mjs` can report the difference instead of renaming it.
 */

/** Exit status for a run that found lint findings. */
export const LINT_FINDINGS = 1;

/** Exit status for a run that inspected nothing. Distinct from a finding. */
export const LINT_NOTHING_INSPECTED = 2;

/** Exit status for a run that could not start. */
export const LINT_MISCONFIGURED = 3;

/**
 * How many files biome reported checking, summed over every run in `output`.
 *
 * A run can be split into chunks, so there may be more than one summary line.
 * Null when biome printed no summary at all — a crash, a missing config, or an
 * unrecognised version — which is not the same as zero files.
 */
export function checkedFileCount(output) {
  const counts = [...String(output).matchAll(/Checked (\d+) files?/gu)].map((match) =>
    Number(match[1]),
  );
  if (counts.length === 0) return null;
  return counts.reduce((total, count) => total + count, 0);
}

/** Whether biome said every path it was given is excluded by its configuration. */
export function ignoredEveryGivenPath(output) {
  return /These paths were provided but ignored/iu.test(String(output));
}

/**
 * The exit status for one completed biome run.
 *
 * `status` is the process status biome exited with (null when it could not
 * start) and `output` is everything it printed. A summary of zero files, or the
 * "provided but ignored" note, is reported as `LINT_NOTHING_INSPECTED` whatever
 * biome's own status was: the run did not inspect the code, so its complaints
 * are not evidence about the code.
 */
export function lintOutcome({ status, output }) {
  const checked = checkedFileCount(output);
  if (ignoredEveryGivenPath(output)) return LINT_NOTHING_INSPECTED;
  if (checked === 0) return LINT_NOTHING_INSPECTED;
  if (status === null || status === undefined) return LINT_MISCONFIGURED;
  return status === 0 ? 0 : LINT_FINDINGS;
}
