/**
 * Install built packs into this machine's Suite Desk slop profile, the way its own
 * installer would, but without the native confirmation dialog.
 *
 * The dialog is a real modal (`confirmInstall` calls `dialog.showMessageBox`), so it cannot
 * be driven headlessly. Everything else is the host's own code: `installPackArchive`
 * verifies the signature, the manifest hashes, the publisher trust and the host fit before
 * it writes anything, so an archive this refuses is one the app would refuse too.
 *
 *   node hosts/desk/scripts/install-local-pack.mjs <pack.suitepack> [...]
 *
 * The host modules are loaded from `dist` through computed paths on purpose. They are build
 * output, and a static `../dist/x.js` import sends Biome through the workspace symlinks
 * into `packages/*`, where it panics on a path outside its root.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const load = async (name) => import(pathToFileURL(join(dist, name)).href);

const { installPackArchive } = await load("installedPacks.js");
const { HOST_CAPABILITIES, HOST_CONTRACT_VERSION, HOST_VERSION, hostRingsFor } =
  await load("packs.js");
const { openPublisherTrust, trustRootFor } = await load("publisherTrust.js");

const dataRoot = join(homedir(), ".var/app/run.suite.slop.desk/config/Suite Desk/desk");
const packsRoot = join(dataRoot, "packs");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: install-local-pack.mjs <pack.suitepack> [...]");
  process.exit(1);
}

const trust = await openPublisherTrust(trustRootFor(dataRoot, process.env));
const options = {
  publishers: trust.publishers,
  hostContractVersion: HOST_CONTRACT_VERSION,
  hostVersion: HOST_VERSION,
  hostCapabilities: HOST_CAPABILITIES,
  rings: hostRingsFor(process.env.SUITE_DESK_RINGS),
};

for (const file of files) {
  const path = resolve(file);
  const bytes = new Uint8Array(await readFile(path));
  try {
    const installed = await installPackArchive(bytes, packsRoot, options, { replace: true });
    console.log(`installed ${installed.id} ${installed.version} -> ${installed.root}`);
  } catch (error) {
    console.error(`refused ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
