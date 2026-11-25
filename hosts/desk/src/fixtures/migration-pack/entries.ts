/**
 * The fixture pack's own entry bodies.
 *
 * A real pack ships these as the declared HTML entries and the host runs them
 * in the pack's renderer. The test supplies them through the same runner
 * interface, so the host code under test sees exactly what it would see in
 * production: bytes in, bytes out, no host access to the pack's format.
 */
import type { ScopedDocumentHandle, ScopedProjectionHandle } from "../../documentMigrations.js";

const decode = (bytes: Uint8Array): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

/** The two-step chain 1 → 2 → 3 the manifest declares. */
export const migrations: Record<string, (document: ScopedDocumentHandle) => Promise<void>> = {
  "migrate-1-2.html": async (document) => {
    const note = decode(await document.read());
    note.body = "";
    note.migratedThrough = 2;
    await document.write(encode(note));
  },
  "migrate-2-3.html": async (document) => {
    const note = decode(await document.read());
    note.tags = [];
    note.migratedThrough = 3;
    await document.write(encode(note));
  },
};

export const projections: Record<
  string,
  (document: ScopedProjectionHandle) => Promise<Uint8Array>
> = {
  "project.html": async (document) => {
    const note = decode(await document.read());
    return encode({ title: note.title, tags: note.tags ?? [] });
  },
};
