import { describe, expect, it, vi } from "vitest";

import { DocumentReplica } from "./replica.js";

/** The smallest document the replica needs: a snapshot, an observer and a local edit. */
class FakeDocument {
  #value: number;
  #listeners = new Set<(update: Uint8Array) => void>();

  constructor(value = 0) {
    this.#value = value;
  }

  get value(): number {
    return this.#value;
  }

  get observerCount(): number {
    return this.#listeners.size;
  }

  getSnapshot(): { value: number; observed: number } {
    return { value: this.#value, observed: this.#listeners.size };
  }

  observe(listener: (update: Uint8Array) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  edit(value: number): void {
    this.#value = value;
    for (const listener of this.#listeners) listener(new Uint8Array([value]));
  }
}

function load(bytes: Uint8Array): FakeDocument {
  return new FakeDocument(bytes[0] ?? 0);
}

describe("DocumentReplica", () => {
  it("should forward an edit, rebuild the snapshot and notify subscribers", async () => {
    const doc = new FakeDocument();
    const commit = vi.fn(async () => undefined);
    const replica = new DocumentReplica({ doc, load, commit });
    const subscriber = vi.fn();
    const unsubscribe = replica.subscribe(subscriber);

    doc.edit(7);
    await Promise.resolve();

    expect(commit).toHaveBeenCalledWith(new Uint8Array([7]));
    expect(replica.getSnapshot().value).toBe(7);
    expect(subscriber).toHaveBeenCalledTimes(1);

    unsubscribe();
    doc.edit(9);
    await Promise.resolve();

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(replica.getSnapshot().value).toBe(9);
  });

  it("should load a replacement document and observe the new one", () => {
    const doc = new FakeDocument(1);
    const commit = vi.fn(async () => undefined);
    const replica = new DocumentReplica({ doc, load, commit });

    replica.replace(new Uint8Array([4]));

    expect(replica.document.value).toBe(4);
    expect(replica.getSnapshot().value).toBe(4);
    expect(doc.observerCount).toBe(0);
    expect(replica.document.observerCount).toBe(1);
  });

  it("should stop observing after dispose", async () => {
    const doc = new FakeDocument();
    const commit = vi.fn(async () => undefined);
    const replica = new DocumentReplica({ doc, load, commit });
    const subscriber = vi.fn();
    replica.subscribe(subscriber);

    replica.dispose();
    doc.edit(3);
    await Promise.resolve();

    expect(doc.observerCount).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });
});
