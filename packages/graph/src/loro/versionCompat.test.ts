import { LoroDoc as CurrentLoroDoc } from "loro-crdt";
import { LoroDoc as PreviousLoroDoc } from "loro-crdt-1-16";
import { describe, expect, it } from "vitest";

/**
 * A document written by one release has to open in the next one.
 *
 * Desktop and phone are not upgraded on the same afternoon, and they exchange snapshots the whole
 * time, so the interesting direction is the one that cannot be repaired after the fact: an *older*
 * replica meeting a *newer* document. `loro-crdt` 1.16.4 fixed exactly the traps that produced —
 * containers of a type the reader does not know — which is why this runs against that release
 * rather than against a mock.
 *
 * `loro-crdt-1-16` is an alias for `loro-crdt@1.16.4` installed only here, so both builds can hold
 * a conversation in one process. Move the alias forward with the next bump; the point is to always
 * have the release we shipped last, not a specific number.
 */

const PREVIOUS = "1.16.4";

/**
 * The three containers both releases understand. Structural rather than nominal because the two
 * builds are different classes and the test is about the *format*, not about either type.
 */
type AnyLoroDoc = {
  getText(name: string): { insert(index: number, text: string): void; toString(): string };
  getMap(name: string): { set(key: string, value: string): void; get(key: string): unknown };
  getList(name: string): { insert(index: number, value: string): void; toJSON(): unknown };
  commit(): void;
};

function seed(doc: AnyLoroDoc) {
  doc.getText("title").insert(0, "Quarterly review");
  doc.getMap("meta").set("owner", "dana");
  doc.getList("tags").insert(0, "alpha");
  doc.commit();
}

describe("loro cross-version compatibility", () => {
  it(`reads a snapshot written by ${PREVIOUS}`, () => {
    const previous = new PreviousLoroDoc();
    seed(previous);

    const current = CurrentLoroDoc.fromSnapshot(previous.export({ mode: "snapshot" }));

    expect(current.getText("title").toString()).toBe("Quarterly review");
    expect(current.getMap("meta").get("owner")).toBe("dana");
    expect(current.getList("tags").toJSON()).toEqual(["alpha"]);
  });

  it(`is readable by ${PREVIOUS}`, () => {
    const current = new CurrentLoroDoc();
    seed(current);

    const previous = PreviousLoroDoc.fromSnapshot(current.export({ mode: "snapshot" }));

    expect(previous.getText("title").toString()).toBe("Quarterly review");
    expect(previous.getMap("meta").get("owner")).toBe("dana");
    expect(previous.getList("tags").toJSON()).toEqual(["alpha"]);
  });

  it(`exchanges an incremental update with ${PREVIOUS} in both directions`, () => {
    // A snapshot round-trip is the easy case. The one that runs on every keystroke is an update
    // from a document the receiver already has, and that is what a late-joining peer replays.
    const previous = new PreviousLoroDoc();
    seed(previous);

    const current = CurrentLoroDoc.fromSnapshot(previous.export({ mode: "snapshot" }));
    current.getText("title").insert(current.getText("title").length, " — Q3");
    current.commit();
    previous.import(current.export({ mode: "update" }));
    expect(previous.getText("title").toString()).toBe("Quarterly review — Q3");

    previous.getList("tags").insert(1, "beta");
    previous.commit();
    current.import(previous.export({ mode: "update" }));
    expect(current.getList("tags").toJSON()).toEqual(["alpha", "beta"]);

    // Both replicas now agree, which is the property the whole exchange exists for.
    expect(current.toJSON()).toEqual(previous.toJSON());
  });
});
