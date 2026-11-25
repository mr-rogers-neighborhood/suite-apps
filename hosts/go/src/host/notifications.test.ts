import { describe, expect, it } from "vitest";
import {
  numericNotificationId,
  permissionFrom,
  unsupportedNotifications,
} from "./notifications.js";

describe("numericNotificationId", () => {
  it("should be stable for the same task id", () => {
    expect(numericNotificationId("3f2a-task")).toBe(numericNotificationId("3f2a-task"));
  });

  it("should fit the 31-bit range Capacitor stores", () => {
    for (const id of ["a", "task-1", "0e5d1c2b-1111-4222-8333-444455556666", "é"]) {
      const value = numericNotificationId(id);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(0x7fffffff);
    }
  });

  it("should separate ordinary task ids", () => {
    const ids = ["a", "b", "c", "task-1", "task-2", "task-10"].map(numericNotificationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("permissionFrom", () => {
  it("should map every state the plugin can answer", () => {
    expect(permissionFrom("granted")).toBe("granted");
    expect(permissionFrom("denied")).toBe("denied");
    expect(permissionFrom("prompt")).toBe("prompt");
    expect(permissionFrom("prompt-with-rationale")).toBe("prompt");
  });

  it("should treat an unknown answer as unsupported rather than granted", () => {
    expect(permissionFrom("something new")).toBe("unsupported");
  });
});

describe("unsupportedNotifications", () => {
  it("should refuse a schedule instead of pretending one was made", async () => {
    const notifications = unsupportedNotifications();

    expect(await notifications.permission()).toBe("unsupported");
    expect(await notifications.schedule({ id: "a", title: "A", at: Date.now() })).toEqual({
      ok: false,
      permission: "unsupported",
      reason: "unsupported",
    });
  });
});
