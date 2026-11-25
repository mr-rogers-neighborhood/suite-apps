#!/usr/bin/env node
/**
 * Checks that the pages which name a release point at the newest one.
 *
 * A release list is only available where the release pages are: a push to
 * `main` or the nightly. This check runs there, never on a pull request, and it
 * reads the same list `scripts/release-status.mjs` uses for the pages and the
 * README.
 *
 * For every channel the README must keep its row (the stable row links the
 * Latest alias; a pre-release row names the page shape pruning keeps), the
 * landing page must link both README table sections, the docs index must link
 * the Channels page and the release list, and no surface may name a concrete
 * release tag that is not the newest published page of its channel.
 *
 * Usage: node scripts/site-check.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHANNEL_ORDER,
  README_FILE,
  ROOT,
  channelTagPattern,
  existingReleases,
  isChannelTag,
  newestPages,
  readmeChannelsDrift,
} from "./release-status.mjs";

const LANDING_FILE = "site/src/index.html";
const BUILT_LANDING_FILE = "site/dist/index.html";
const DOCS_INDEX_FILE = "docs/README.md";
const BUILT_DOCS_INDEX_FILE = "site/dist/docs/index.html";

/** A link to one published release page. */
const RELEASE_LINK =
  /https:\/\/github\.com\/mrrnbhd\/suite-apps\/releases\/tag\/(suite-[0-9a-z][\w.-]*[0-9a-z])/gu;
/** A tag named in backticks, but not a placeholder such as `suite-nightly-<date>`. */
const RELEASE_TAG =
  /`(suite-(?:slop|nightly|preview)-[0-9][\w.-]*|suite-[0-9]{4}\.[0-9]{2}\.[0-9]{2})`/gu;
/** The release list a surface may point at instead of a concrete tag. */
const RELEASE_LIST = /releases\/latest|RELEASES\.md/u;
/** The docs page that owns what a channel promises, in Markdown or built HTML. */
const CHANNELS_PAGE = /(?:\]\(|href=")[^")]*channels\.(?:md|html)(?:#[^")]*)?(?:\)|")/u;

function channelOfTag(tag) {
  return CHANNEL_ORDER.find((channel) => isChannelTag(tag, channel)) ?? null;
}

function missingChannel(channel) {
  return (
    `${channel}: the release list has no published page; ` +
    `expected a tag matching ${String(channelTagPattern(channel))}`
  );
}

/**
 * The problems in the pages, given a release list and the page texts.
 *
 * `releases` is the shape `gh release list` returns; `pages` carries the
 * surfaces that exist. The built pages are optional so a checkout can run the
 * check before `site:build`.
 */
export function siteProblems({ releases, pages }) {
  const problems = [];
  const newest = newestPages(releases);

  for (const channel of CHANNEL_ORDER) {
    if (newest[channel] !== null) continue;
    problems.push(missingChannel(channel));
  }

  if (pages.readme !== undefined) {
    const drift = readmeChannelsDrift(pages.readme);
    if (drift !== null) problems.push(drift);
    for (const channel of CHANNEL_ORDER) {
      const row = new RegExp(`^\\| \`${channel}\` \\|`, "mu");
      if (!row.test(pages.readme)) {
        problems.push(`${README_FILE}: no ${channel} row in the generated channel tables`);
      }
    }
  }

  const surfaces = [
    [README_FILE, pages.readme],
    [LANDING_FILE, pages.landing],
    [BUILT_LANDING_FILE, pages.builtLanding],
    [DOCS_INDEX_FILE, pages.docsIndex],
    [BUILT_DOCS_INDEX_FILE, pages.builtDocsIndex],
  ].filter(([, text]) => text !== undefined);

  for (const [file, text] of surfaces) {
    if (!RELEASE_LIST.test(text)) {
      problems.push(`${file}: no link to the release list; expected releases/latest or RELEASES.md`);
    }

    const seen = new Set();
    for (const match of text.matchAll(RELEASE_LINK)) seen.add(match[1]);
    for (const match of text.matchAll(RELEASE_TAG)) seen.add(match[1]);
    for (const tag of seen) {
      const channel = channelOfTag(tag);
      if (channel === null || newest[channel] === null) continue;
      if (tag !== newest[channel]) {
        problems.push(`${file}: ${channel} links ${tag}, expected ${newest[channel]}`);
      }
    }
  }

  for (const [file, text] of [
    [LANDING_FILE, pages.landing],
    [BUILT_LANDING_FILE, pages.builtLanding],
  ]) {
    if (text === undefined) continue;
    for (const anchor of ["#release", "#pre-release"]) {
      if (!text.includes(anchor)) {
        problems.push(`${file}: no ${anchor} link to the README channel tables`);
      }
    }
  }

  for (const [file, text] of [
    [DOCS_INDEX_FILE, pages.docsIndex],
    [BUILT_DOCS_INDEX_FILE, pages.builtDocsIndex],
  ]) {
    if (text === undefined) continue;
    if (!CHANNELS_PAGE.test(text)) {
      problems.push(`${file}: no link to the Channels page`);
    }
  }

  return problems;
}

/** The surfaces this checkout carries; a built page is read only when it exists. */
export function readSitePages() {
  function optional(file) {
    const path = join(ROOT, file);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  return {
    readme: readFileSync(join(ROOT, README_FILE), "utf8"),
    landing: readFileSync(join(ROOT, LANDING_FILE), "utf8"),
    builtLanding: optional(BUILT_LANDING_FILE),
    docsIndex: readFileSync(join(ROOT, DOCS_INDEX_FILE), "utf8"),
    builtDocsIndex: optional(BUILT_DOCS_INDEX_FILE),
  };
}

function main() {
  const releases = existingReleases();
  if (releases === null) {
    process.stderr.write(
      "site-check: gh release list failed; this check runs where the release list is available " +
        "(main or nightly), not on a pull request.\n",
    );
    process.exit(1);
  }

  const problems = siteProblems({ releases, pages: readSitePages() });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${problems.length} site release problem(s).`);
    process.exit(1);
  }

  const newest = newestPages(releases);
  const pages = CHANNEL_ORDER.map((channel) => `${channel}=${newest[channel]}`).join(", ");
  process.stdout.write(
    `site-check: README, landing page and docs index carry the newest pages (${pages}).\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
