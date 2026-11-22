#!/usr/bin/env node
/**
 * The signing keys: where they are, whether they match what this tree trusts, and how to make one.
 *
 * Why a command rather than a paragraph: a pack signed by the wrong key installs nowhere, and an
 * update feed signed by the wrong key is refused by every app that is already installed. Both
 * failures are discovered late — after a build, in a device log or on somebody else's machine.
 * `pnpm keys status` answers the question in one line, before anything is signed.
 *
 * Usage:
 *   pnpm keys status            what exists, its fingerprint, and whether the pin accepts it
 *   pnpm keys status --strict   also fail when a key is absent, for a machine that signs
 *   pnpm keys generate pack     a new pack signing keypair
 *   pnpm keys generate update   a new update signing keypair
 *   pnpm keys --help
 *
 * Nothing here prints a private key. `generate` writes one file, owned and readable by its owner
 * alone, in a directory outside the repository.
 */
import { KEYS, generateKey, groupedFingerprint, inspectKey, keysDir } from "./lib/keys.mjs";

const args = process.argv.slice(2);

function help() {
  process.stdout.write(`Suite signing keys

  pnpm keys status [--strict]      presence, fingerprint, and the pin each key must match
  pnpm keys generate pack          make the shared desktop and mobile pack signing key
  pnpm keys generate update        make the update feed signing key

The private keys live outside the repository, at
${keysDir()}
or wherever SUITE_KEYS_DIR points. Public halves are pinned in the source that verifies them:

  pack     ${KEYS.pack.pinFile}  ${KEYS.pack.pinName}
  update   ${KEYS.update.pinFile}  ${KEYS.update.pinName}

A key that is absent is a warning, not a failure: a clean checkout does not sign anything.
A key that is present and does not match its pin is a failure, because what it signs is refused.
`);
}

function status() {
  const strict = args.includes("--strict");
  process.stdout.write(`Suite keys · ${keysDir()}\n\n`);

  let failed = false;
  const labels = Object.values(KEYS).map((spec) => spec.label);
  const width = Math.max(...labels.map((label) => label.length));
  const line = (mark, label, first, second = "") => {
    process.stdout.write(
      `${mark} ${label.padEnd(width)}  ${first.padEnd(41)}${second}\n`,
    );
  };

  for (const name of Object.keys(KEYS)) {
    const result = inspectKey(name);

    if (result.state === "absent") {
      line("-", result.spec.label, "not present", result.spec.generate);
      if (strict) failed = true;
      continue;
    }

    if (result.state === "matches") {
      line("ok", result.spec.label, groupedFingerprint(result.fingerprint), `matches ${result.spec.pinName}`);
      continue;
    }

    failed = true;
    process.stdout.write(`!! ${result.spec.label.padEnd(width)}  ${result.detail}\n`);
    process.stdout.write(`   ${" ".repeat(width)}  ${result.path}\n`);
    if (result.state === "mismatch") {
      process.stdout.write(
        `   ${" ".repeat(width)}  this key       ${groupedFingerprint(result.fingerprint)}\n`,
      );
      process.stdout.write(
        `   ${" ".repeat(width)}  ${result.spec.pinName.padEnd(13)} ${groupedFingerprint(result.pinFingerprint)}\n`,
      );
      process.stdout.write(
        `   ${" ".repeat(width)}  What this key signs is refused. Pin this key, or put the one the\n` +
          `   ${" ".repeat(width)}  tree already trusts in ${keysDir()}.\n`,
      );
    }
  }

  process.stdout.write("\n");
  if (failed) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Every key present on this machine matches the pin.\n");
}

function generate(name) {
  const spec = KEYS[name];
  if (spec === undefined) {
    process.stderr.write(`No key named ${name ?? "(missing)"}. Keys: ${Object.keys(KEYS).join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  const result = generateKey(name, { force: args.includes("--force") });

  process.stdout.write(`wrote ${result.path}\n`);
  process.stdout.write(`      ${spec.algorithm}, ${spec.encoding}, readable by its owner alone\n\n`);

  if (name === "pack") {
    process.stdout.write(`Pin this public half in ${spec.pinFile}:\n\n`);
    process.stdout.write(`  export const ${spec.pinName} = "${result.publicText}";\n\n`);
  } else {
    process.stdout.write(`Pin this public half in ${spec.pinFile}:\n\n`);
    process.stdout.write(`${result.publicText}\n\n`);
  }

  process.stdout.write(`fingerprint ${groupedFingerprint(result.fingerprint)}\n`);
  process.stdout.write(
    `\nThe private half is in ${result.path} and nowhere else. It is not in the repository.\n` +
      "Copy it to wherever you keep secrets before you need it; `pnpm keys status` prints the\n" +
      "fingerprint again, so you can tell a restored copy from a different key.\n",
  );
}

const command = args[0];

if (command === undefined || command === "help" || command === "--help" || command === "-h") {
  help();
} else if (command === "status") {
  status();
} else if (command === "generate") {
  generate(args[1]);
} else {
  process.stderr.write(`Unknown command: ${command}\n\n`);
  help();
  process.exitCode = 1;
}
