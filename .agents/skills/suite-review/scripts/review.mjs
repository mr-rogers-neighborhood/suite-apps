#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const EXCLUDES = [
  "apps/start/**",
  ".dev/**",
  ".artifacts/**",
  ".flatpak-builder/**",
  "node_modules/**",
  "dist/**",
  ".opencode/**",
  ".agents/**",
  ".commandcode/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
].join(",");

const DEFAULTS = {
  effort: "low",
  budget: 200_000,
  maxTokens: 120_000,
  concurrency: 4,
  gitProcs: 4,
  timeout: 10,
};

function usage() {
  console.log(`Usage: review.mjs [options]

  --from <ref>        Base ref (default: main)
  --to <ref>          Target ref (default: HEAD with --from)
  --commit <sha>      Review one commit instead of a range
  --workspace         Review the working tree instead of a range
  --effort <level>    low | medium | high (default: ${DEFAULTS.effort})
  --budget <n>        Total input+output token cap (default: ${DEFAULTS.budget})
  --provider <name>   Override the configured provider
  --model <name>      Override the configured model
  --output <path>     Write the JSON here instead of .dev/ocr/<timestamp>.json
  --print-preview     Print the free preview and stop
  --check             Run "ocr llm test" first
  -h, --help`);
}

function parseArgs(argv) {
  const out = { from: "main", effort: DEFAULTS.effort, budget: DEFAULTS.budget };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--from": out.from = next(); break;
      case "--to": out.to = next(); break;
      case "--commit": out.commit = next(); break;
      case "--workspace": out.workspace = true; break;
      case "--effort": out.effort = next(); break;
      case "--budget": out.budget = Number(next()); break;
      case "--provider": out.provider = next(); break;
      case "--model": out.model = next(); break;
      case "--output": out.output = next(); break;
      case "--print-preview": out.printPreview = true; break;
      case "--check": out.check = true; break;
      case "-h":
      case "--help": out.help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (out.workspace && (out.commit || out.to || out.from !== "main")) {
    throw new Error("--workspace cannot be combined with --from/--to/--commit");
  }
  if (out.commit && (out.to || out.workspace)) {
    throw new Error("--commit cannot be combined with --to/--workspace");
  }
  if (!["low", "medium", "high"].includes(out.effort)) {
    throw new Error("--effort must be low, medium, or high");
  }
  if (!Number.isFinite(out.budget) || out.budget <= 0) {
    throw new Error("--budget must be a positive number");
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function tryRun(cmd, args, opts = {}) {
  try {
    return { ok: true, stdout: run(cmd, args, opts), stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "",
      status: error.status ?? 1,
    };
  }
}

function modeArgs(args) {
  if (args.workspace) return [];
  if (args.commit) return ["--commit", args.commit];
  const mode = ["--from", args.from];
  if (args.to) mode.push("--to", args.to);
  return mode;
}

function parseJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function severityCounts(comments) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, other: 0 };
  for (const comment of comments ?? []) {
    const key = comment?.severity;
    if (key in counts) counts[key] += 1;
    else counts.other += 1;
  }
  return counts;
}

function printFindings(comments, limit = 10) {
  const ranked = [...(comments ?? [])].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a?.severity] ?? 4) - (order[b?.severity] ?? 4);
  });
  for (const comment of ranked.slice(0, limit)) {
    const where = [comment.path, comment.start_line].filter(Boolean).join(":");
    const severity = (comment.severity ?? "unrated").toUpperCase();
    console.log(`\n[${severity}] ${where}`);
    console.log(String(comment.content ?? "").trim());
  }
  if (ranked.length > limit) console.log(`\n… ${ranked.length - limit} more in the JSON output`);
}

function providerFailure(stderr, stdout) {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return [
    "quota",
    "credit",
    "spend limit",
    "unauthorized",
    "401",
    "402",
    "403",
    "provider",
    "connection refused",
    "no such host",
    "llm request timeout",
  ].some((needle) => text.includes(needle));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }
  if (args.help) { usage(); return; }

  for (const [cmd, argsList] of [
    ["ocr", ["--version"]],
    ["git", ["--version"]],
  ]) {
    const result = tryRun(cmd, argsList);
    if (!result.ok) {
      console.error(`${cmd} is required. ${cmd === "ocr" ? "Install: npm install -g @alibaba-group/open-code-review" : ""}`);
      process.exit(1);
    }
  }

  const gitVersion = run("git", ["--version"]).match(/(\d+)\.(\d+)/);
  if (!gitVersion || Number(gitVersion[1]) < 2 || (Number(gitVersion[1]) === 2 && Number(gitVersion[2]) < 41)) {
    console.error("OCR requires Git >= 2.41");
    process.exit(1);
  }

  if (args.check) {
    const check = tryRun("ocr", ["llm", "test"]);
    process.stdout.write(check.stdout);
    process.stderr.write(check.stderr);
    if (!check.ok) {
      console.error("\nOCR cannot reach its provider. See docs/reference/code-review.md.");
      process.exit(2);
    }
  }

  const mode = modeArgs(args);
  const previewArgs = ["review", "--preview", "--format", "json", "--audience", "agent", ...mode, "--exclude", EXCLUDES];
  const preview = tryRun("ocr", previewArgs);
  if (!preview.ok) {
    process.stderr.write(preview.stderr);
    console.error("\nPreview failed before any model call. Check ocr config and git refs.");
    process.exit(1);
  }

  const previewJson = parseJson(preview.stdout);
  const reviewable = previewJson?.reviewable_count ?? previewJson?.reviewable_files?.length ?? 0;
  const total = previewJson?.total_files ?? reviewable;

  if (reviewable === 0) {
    console.log(`No reviewable files (${total} changed, all excluded). Nothing spent.`);
    return;
  }

  console.log(`Reviewable: ${reviewable}/${total} changed files`);
  if (args.printPreview) {
    const files = (previewJson?.files ?? []).filter((file) => file.will_review);
    for (const file of files) console.log(`  ${file.path} (${file.status}, +${file.insertions} -${file.deletions})`);
    return;
  }

  const outDir = join(process.cwd(), ".dev", "ocr");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const outFile = args.output ? resolve(process.cwd(), args.output) : join(outDir, `${stamp}.json`);
  mkdirSync(dirname(outFile), { recursive: true });

  const reviewArgs = [
    "review",
    "--format", "json",
    "--audience", "agent",
    "--output", outFile,
    "--effort", args.effort,
    "--max-tokens-budget", String(args.budget),
    "--max-tokens", String(DEFAULTS.maxTokens),
    "--concurrency", String(DEFAULTS.concurrency),
    "--max-git-procs", String(DEFAULTS.gitProcs),
    "--timeout", String(DEFAULTS.timeout),
    ...mode,
    "--exclude", EXCLUDES,
  ];
  if (args.provider) reviewArgs.push("--provider", args.provider);
  if (args.model) reviewArgs.push("--model", args.model);

  const review = tryRun("ocr", reviewArgs, { timeout: 30 * 60 * 1000 });
  process.stderr.write(review.stderr);

  if (!review.ok) {
    if (providerFailure(review.stderr, review.stdout)) {
      console.error(
        "\nOCR provider failed. No automatic retry: a quota loop burns the budget.\n" +
          "Fallback is delegation mode with the host model:\n" +
          `  ocr delegate preview --format json --exclude "${EXCLUDES}" ${mode.join(" ")}\n` +
          `  ocr delegate rule ${mode.join(" ")} --format json <paths>\n` +
          "then review the diffs per .agents/skills/suite-review/SKILL.md.",
      );
      process.exit(2);
    }
    console.error("\nOCR review failed for a reason other than the provider.");
    process.exit(1);
  }

  if (!existsSync(outFile)) {
    console.error("OCR reported success but wrote no JSON output.");
    process.exit(1);
  }

  const result = JSON.parse(readFileSync(outFile, "utf8"));
  const comments = result.comments ?? [];
  const counts = severityCounts(comments);
  const summary = result.summary ?? {};
  const model = `${result.llm?.provider ?? "configured"} / ${result.llm?.model ?? "default"}`;

  console.log(`\nOCR ${model}`);
  console.log(`status: ${result.status ?? "unknown"}`);
  console.log(`files: ${summary.files_reviewed ?? reviewable} reviewed`);
  console.log(
    `comments: ${comments.length} (critical ${counts.critical}, high ${counts.high}, ` +
      `medium ${counts.medium}, low ${counts.low}${counts.other ? `, other ${counts.other}` : ""})`,
  );
  console.log(
    `tokens: ${summary.total_tokens ?? "?"} (in ${summary.input_tokens ?? "?"}, ` +
      `out ${summary.output_tokens ?? "?"}${summary.cache_read_tokens ? `, cache read ${summary.cache_read_tokens}` : ""})`,
  );
  console.log(`elapsed: ${summary.elapsed ?? "?"}`);
  console.log(`json: ${outFile}`);

  if (comments.length > 0) printFindings(comments);
  console.log("\nReview-only. This is not the gate.");
}

main();
