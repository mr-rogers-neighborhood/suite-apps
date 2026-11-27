import { describe, expect, it } from "vitest";
import {
  exportScreenFile,
  parseScreenFile,
  SCREEN_FILE_ENVELOPE_VERSION,
  SCREEN_FILE_EXTENSION,
  SCREEN_FILE_MAGIC,
  SCREEN_FILE_MAX_BYTES,
  SCREEN_FILE_MEDIA_TYPE,
} from "./codec.js";
import { ScreenDocument } from "./document.js";
import type { Screen } from "./screen.js";

const screen: Screen = {
  format: "suite.screen",
  version: 3,
  id: "work",
  name: "Work",
  widgets: [
    { registryId: "desk.apps", size: "full", x: 0, y: 0 },
    {
      registryId: "ghost.notes",
      size: "2x1",
      x: 0,
      y: 1,
      settings: { "future-setting": "kept" },
    },
    {
      kind: "row",
      size: "full",
      x: 0,
      y: 2,
      layout: "row",
      items: [
        { registryId: "planner.quick-task", weight: 2, settings: { project: "work" } },
        { registryId: "budget.saved-views", weight: 1 },
      ],
    },
  ],
};

function documentFor(value: Screen): ScreenDocument {
  return ScreenDocument.create(value);
}

function customFile(options: {
  header?: Record<string, unknown>;
  payload?: Uint8Array;
  envelopeVersion?: number;
  magic?: string;
}): Uint8Array {
  const payload = options.payload ?? new Uint8Array([1, 2, 3]);
  const header = options.header ?? {
    format: "suite.screen",
    version: 2,
    id: "work",
    name: "Work",
    home: false,
    payloadLength: payload.byteLength,
  };
  const magic = new TextEncoder().encode(options.magic ?? SCREEN_FILE_MAGIC);
  const body = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(magic.byteLength + 2 + 4 + body.byteLength + payload.byteLength);
  out.set(magic, 0);
  const view = new DataView(out.buffer);
  view.setUint16(magic.byteLength, options.envelopeVersion ?? SCREEN_FILE_ENVELOPE_VERSION);
  view.setUint32(magic.byteLength + 2, body.byteLength);
  out.set(body, magic.byteLength + 6);
  out.set(payload, magic.byteLength + 6 + body.byteLength);
  return out;
}

describe("the portable .screen file", () => {
  it("names a stable extension and media type", () => {
    expect(SCREEN_FILE_EXTENSION).toBe(".screen");
    expect(SCREEN_FILE_MEDIA_TYPE).toBe("application/vnd.suite.screen");
  });

  it("round-trips a Screen, its row, unknown widget and settings", () => {
    const parsed = parseScreenFile(exportScreenFile(documentFor(screen), { home: true }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.home).toBe(true);
    expect(parsed.fromVersion).toBe(3);
    expect(parsed.screen).toEqual(screen);
    expect(parsed.document.state()).toEqual(screen);
  });

  it("writes a versioned envelope with only the Screen's own facts", () => {
    const bytes = exportScreenFile(documentFor(screen));
    expect(new TextDecoder().decode(bytes.subarray(0, SCREEN_FILE_MAGIC.length))).toBe(
      SCREEN_FILE_MAGIC,
    );

    const headerLength = new DataView(bytes.buffer).getUint32(SCREEN_FILE_MAGIC.length + 2);
    const header = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(SCREEN_FILE_MAGIC.length + 6, SCREEN_FILE_MAGIC.length + 6 + headerLength),
      ),
    );
    expect(header).toEqual({
      format: "suite.screen",
      version: 3,
      id: "work",
      name: "Work",
      home: false,
      payloadLength: expect.any(Number),
    });
    expect(JSON.stringify(header)).not.toContain("/");
  });

  it("refuses a file that is not a Suite screen file", () => {
    const refused = parseScreenFile(new Uint8Array([1, 2, 3]));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("corrupt");
    expect(refused.message).toContain("not a Suite screen file");
  });

  it("refuses a newer screen version with the next action", () => {
    const payload = documentFor(screen).export();
    const refused = parseScreenFile(
      customFile({
        payload,
        header: {
          format: "suite.screen",
          version: 9,
          id: "work",
          name: "Work",
          home: false,
          payloadLength: payload.byteLength,
        },
      }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("newer");
    expect(refused.message).toContain("Update Suite Desk");
  });

  it("refuses a newer envelope version before reading the snapshot", () => {
    const refused = parseScreenFile(
      customFile({ envelopeVersion: SCREEN_FILE_ENVELOPE_VERSION + 1 }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("newer");
    expect(refused.message).toContain("Update Suite Desk");
  });

  it("refuses a header that does not match its bytes", () => {
    const refused = parseScreenFile(
      customFile({
        header: {
          format: "suite.screen",
          version: 2,
          id: "work",
          name: "Work",
          home: false,
          payloadLength: 99,
        },
      }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("does not match its bytes");
  });

  it("refuses a header whose version differs from the snapshot", () => {
    const payload = documentFor(screen).export();
    const refused = parseScreenFile(
      customFile({
        payload,
        header: {
          format: "suite.screen",
          version: 1,
          id: "work",
          name: "Work",
          home: false,
          payloadLength: payload.byteLength,
        },
      }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("different version");
  });

  it("refuses a header whose id differs from the snapshot", () => {
    const payload = documentFor(screen).export();
    const refused = parseScreenFile(
      customFile({
        payload,
        header: {
          format: "suite.screen",
          version: 3,
          id: "other",
          name: "Work",
          home: false,
          payloadLength: payload.byteLength,
        },
      }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("different Screen");
  });

  it("refuses an oversized file before parsing it", () => {
    const refused = parseScreenFile(new Uint8Array(SCREEN_FILE_MAX_BYTES + 1));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("larger than");
  });

  it("refuses a snapshot that is not a Screen", () => {
    const refused = parseScreenFile(
      customFile({
        payload: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("left alone");
  });
});
