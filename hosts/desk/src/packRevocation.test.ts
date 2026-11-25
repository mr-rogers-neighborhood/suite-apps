import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestPackFiles,
  generatePackKeyPair,
  PACK_FORMAT,
  type PackManifest,
  type PackManifestCore,
  publisherKeyFingerprint,
  signPackManifest,
  type TrustedPublisher,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { afterEach, describe, expect, it } from "vitest";
import {
  type InstalledPackInfo,
  installPackArchive,
  loadInstalledPacks,
  type PackTrustOptions,
} from "./installedPacks.js";
import {
  importRevocationAdvisory,
  openRevocations,
  REVOCATION_KIND,
  type RevocationAdvisoryCore,
  signRevocationAdvisory,
} from "./packRevocation.js";
import { addTrustedPublisher, openPublisherTrust } from "./publisherTrust.js";

const encoder = new TextEncoder();
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-desk-revocation-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Fixture {
  readonly archive: Uint8Array;
  readonly publicKey: string;
}

async function fixture(options: {
  readonly version: string;
  readonly publisherId: string;
  readonly keys: { readonly secretKeyBase64: string; readonly publicKeyBase64: string };
}): Promise<Fixture> {
  const payload = { "index.html": encoder.encode("<!doctype html><title>Demo</title>") };
  const core: PackManifestCore = {
    format: PACK_FORMAT,
    id: "demo",
    name: "Demo",
    version: options.version,
    entry: "index.html",
    contractVersion: 1,
    publisher: { id: options.publisherId, key: options.keys.publicKeyBase64 },
    capabilities: [],
    files: await digestPackFiles(payload),
  };
  const manifest: PackManifest = {
    ...core,
    signature: signPackManifest(core, options.keys.secretKeyBase64),
  };
  return {
    archive: buildPackArchive(manifest, payload),
    publicKey: options.keys.publicKeyBase64,
  };
}

function trustOptions(
  publishers: readonly TrustedPublisher[],
  revocations?: PackTrustOptions["revocations"],
): PackTrustOptions {
  return {
    publishers,
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: ["documents", "files", "network"],
    ...(revocations === undefined ? {} : { revocations }),
  };
}

async function addPublisher(root: string, id: string, key: string): Promise<void> {
  const result = await addTrustedPublisher(root, {
    id,
    key,
    fingerprint: await publisherKeyFingerprint(key),
  });
  expect(result.ok).toBe(true);
}

function bytes(advisory: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(advisory));
}

describe("signed pack revocation", () => {
  // spec: S2.4
  it("blocks a new install but leaves the installed pack running", async () => {
    const root = await temporaryRoot();
    const trustRoot = join(root, "trust");
    const installRoot = join(root, "packs");
    const keys = await generatePackKeyPair();
    await addPublisher(trustRoot, "acme", keys.publicKeyBase64);
    const store = await openPublisherTrust(trustRoot);

    const installed: InstalledPackInfo = await installPackArchive(
      (await fixture({ version: "1.0.0", publisherId: "acme", keys })).archive,
      installRoot,
      trustOptions(store.publishers),
    );
    expect(installed.version).toBe("1.0.0");

    const advisory = signRevocationAdvisory(
      {
        kind: REVOCATION_KIND,
        publisher: "acme",
        pack: "demo",
        issuer: { kind: "publisher", id: "acme" },
        reason: "The signing key was lost.",
      } satisfies RevocationAdvisoryCore,
      keys.secretKeyBase64,
    );
    const imported = await importRevocationAdvisory(trustRoot, bytes(advisory), {
      publishers: store.publishers,
    });
    expect(imported.ok).toBe(true);

    const recorded = await openRevocations(trustRoot);
    expect(recorded.revocations).toHaveLength(1);
    expect(recorded.revocations[0]).toMatchObject({
      publisher: "acme",
      pack: "demo",
      issuer: { kind: "publisher", id: "acme" },
    });

    const newer = await fixture({ version: "1.0.1", publisherId: "acme", keys });
    await expect(
      installPackArchive(
        newer.archive,
        installRoot,
        trustOptions(store.publishers, recorded.revocations),
      ),
    ).rejects.toMatchObject({ reason: "revocation" });

    // The installed version is still loaded: a revocation is not a kill switch.
    const scan = await loadInstalledPacks(
      installRoot,
      trustOptions(store.publishers, recorded.revocations),
    );
    expect(scan.packs).toHaveLength(1);
    expect(scan.packs[0]?.version).toBe("1.0.0");
  });

  // spec: S2.4
  it("refuses one publisher's advisory against another publisher's pack", async () => {
    const root = await temporaryRoot();
    const trustRoot = join(root, "trust");
    const acme = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    await addPublisher(trustRoot, "acme", acme.publicKeyBase64);
    await addPublisher(trustRoot, "other", other.publicKeyBase64);
    const store = await openPublisherTrust(trustRoot);

    // "other" signs an advisory against acme's pack.
    const crossPublisher = signRevocationAdvisory(
      {
        kind: REVOCATION_KIND,
        publisher: "acme",
        pack: "demo",
        issuer: { kind: "publisher", id: "other" },
      } satisfies RevocationAdvisoryCore,
      other.secretKeyBase64,
    );
    const refused = await importRevocationAdvisory(trustRoot, bytes(crossPublisher), {
      publishers: store.publishers,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("cross-publisher");

    // Claiming acme's id is not enough: the signature is still not acme's key.
    const forged = signRevocationAdvisory(
      {
        kind: REVOCATION_KIND,
        publisher: "acme",
        pack: "demo",
        issuer: { kind: "publisher", id: "acme" },
      } satisfies RevocationAdvisoryCore,
      other.secretKeyBase64,
    );
    const forgedRefusal = await importRevocationAdvisory(trustRoot, bytes(forged), {
      publishers: store.publishers,
    });
    expect(forgedRefusal.ok).toBe(false);
    if (forgedRefusal.ok) return;
    expect(forgedRefusal.reason).toBe("bad-signature");

    expect((await openRevocations(trustRoot)).revocations).toHaveLength(0);
  });

  // spec: S2.4
  it("records the person's own advisory and defers the catalogue operator", async () => {
    const root = await temporaryRoot();
    const trustRoot = join(root, "trust");
    const acme = await generatePackKeyPair();
    const operator = await generatePackKeyPair();
    await addPublisher(trustRoot, "acme", acme.publicKeyBase64);
    const store = await openPublisherTrust(trustRoot);

    const person = {
      kind: REVOCATION_KIND,
      publisher: "acme",
      pack: "demo",
      issuer: { kind: "person" },
      reason: "I do not want this pack any more.",
    } satisfies RevocationAdvisoryCore;

    // The unsigned person form is local, so the caller has to offer it.
    const withheld = await importRevocationAdvisory(trustRoot, bytes(person), {
      publishers: store.publishers,
    });
    expect(withheld.ok).toBe(false);
    if (!withheld.ok) expect(withheld.reason).toBe("person-issuer-refused");

    const local = await importRevocationAdvisory(trustRoot, bytes(person), {
      publishers: store.publishers,
      allowPersonIssuer: true,
    });
    expect(local.ok).toBe(true);
    expect((await openRevocations(trustRoot)).revocations).toHaveLength(1);

    const catalogue = signRevocationAdvisory(
      {
        kind: REVOCATION_KIND,
        publisher: "acme",
        pack: "demo",
        issuer: { kind: "catalogue", id: "ops", key: operator.publicKeyBase64 },
      } satisfies RevocationAdvisoryCore,
      operator.secretKeyBase64,
    );
    const deferred = await importRevocationAdvisory(trustRoot, bytes(catalogue), {
      publishers: store.publishers,
    });
    expect(deferred.ok).toBe(false);
    if (deferred.ok) return;
    expect(deferred.reason).toBe("deferred-issuer");
    expect((await openRevocations(trustRoot)).revocations).toHaveLength(1);
  });
});
