import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { frameSchema, inviteRecordSchema, memberRoleSchema, removalRecordSchema, roleRecordSchema, } from "@suite/sync";
export class MemoryHostStore {
    frames = new Map();
    nextIndex = new Map();
    invites = new Map();
    roles = new Map();
    keys = new Map();
    removals = new Map();
    async loadFrames(workspaceId) {
        return [...(this.frames.get(workspaceId) ?? [])];
    }
    async loadNextIndex(workspaceId) {
        return this.nextIndex.get(workspaceId) ?? 0;
    }
    async appendFrame(workspaceId, entry) {
        const existing = this.frames.get(workspaceId) ?? [];
        existing.push(entry);
        this.frames.set(workspaceId, existing);
        this.nextIndex.set(workspaceId, Math.max(this.nextIndex.get(workspaceId) ?? 0, entry.index + 1));
    }
    async loadRoles(workspaceId) {
        return [...(this.roles.get(workspaceId) ?? [])];
    }
    async appendRole(workspaceId, record) {
        const existing = this.roles.get(workspaceId) ?? [];
        existing.push(record);
        this.roles.set(workspaceId, existing);
    }
    async loadInvites(workspaceId) {
        return [...(this.invites.get(workspaceId) ?? [])];
    }
    async appendInvite(workspaceId, record) {
        const existing = this.invites.get(workspaceId) ?? [];
        existing.push(record);
        this.invites.set(workspaceId, existing);
    }
    async loadKeys(workspaceId) {
        return [...(this.keys.get(workspaceId) ?? [])];
    }
    async appendKey(workspaceId, key) {
        const existing = this.keys.get(workspaceId) ?? [];
        existing.push(key);
        this.keys.set(workspaceId, existing);
    }
    async loadRemovals(workspaceId) {
        return [...(this.removals.get(workspaceId) ?? [])];
    }
    async appendRemoval(workspaceId, record) {
        const existing = this.removals.get(workspaceId) ?? [];
        existing.push(record);
        this.removals.set(workspaceId, existing);
    }
    async compact(workspaceId, cutoff) {
        const kept = (this.frames.get(workspaceId) ?? []).filter((entry) => entry.frame.receivedAt >= cutoff);
        this.frames.set(workspaceId, kept);
    }
}
/**
 * One append-only file per workspace, plus one for its roles.
 *
 * A crash mid-append can leave a partial line. That line is dropped on load rather than
 * failing the workspace: a torn write should cost one frame, not the room, because a frame
 * is only ever a message some device can still send again.
 *
 * The frame file holds the frame together with its position. Compaction rewrites the file
 * but never the positions, and a first line records the next position so an emptied log
 * still knows where it was.
 */
export class FileHostStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    async loadFrames(workspaceId) {
        return (await this.readLog(workspaceId)).frames;
    }
    async loadNextIndex(workspaceId) {
        return (await this.readLog(workspaceId)).nextIndex;
    }
    async appendFrame(workspaceId, entry) {
        await this.appendLine(this.framePath(workspaceId), storedLine(entry));
    }
    async loadRoles(workspaceId) {
        return readLines(this.rolePath(workspaceId), (value) => roleRecordSchema.safeParse(value).data);
    }
    async appendRole(workspaceId, record) {
        await this.appendLine(this.rolePath(workspaceId), record);
    }
    async loadInvites(workspaceId) {
        return readLines(this.invitePath(workspaceId), (value) => inviteRecordSchema.safeParse(value).data);
    }
    async appendInvite(workspaceId, record) {
        await this.appendLine(this.invitePath(workspaceId), record);
    }
    async loadKeys(workspaceId) {
        return readLines(this.keyPath(workspaceId), (value) => pinnedKey(value));
    }
    async appendKey(workspaceId, key) {
        await this.appendLine(this.keyPath(workspaceId), key);
    }
    async loadRemovals(workspaceId) {
        return readLines(this.removalPath(workspaceId), (value) => {
            const parsed = removalRecordSchema.safeParse(value);
            return parsed.success ? parsed.data : undefined;
        });
    }
    async appendRemoval(workspaceId, record) {
        await this.appendLine(this.removalPath(workspaceId), record);
    }
    async compact(workspaceId, cutoff) {
        const { frames, nextIndex } = await this.readLog(workspaceId);
        const kept = frames.filter((entry) => entry.frame.receivedAt >= cutoff);
        await mkdir(this.directory, { recursive: true });
        const target = this.framePath(workspaceId);
        const temporary = `${target}.tmp`;
        const header = `${JSON.stringify({ type: "log", nextIndex })}\n`;
        const body = kept.map((entry) => `${JSON.stringify(storedLine(entry))}\n`).join("");
        await writeFile(temporary, `${header}${body}`, "utf8");
        await rename(temporary, target);
    }
    /**
     * Read the frame file as positions plus frames.
     *
     * A file written before positions were stored has bare frame lines. Those are read as
     * consecutive positions from zero, which is exactly what the old array index meant, and
     * the next compaction writes the durable form.
     */
    async readLog(workspaceId) {
        let text;
        try {
            text = await readFile(this.framePath(workspaceId), "utf8");
        }
        catch (error) {
            if (isMissingFile(error))
                return { frames: [], nextIndex: 0 };
            throw error;
        }
        const frames = [];
        let declaredNext = 0;
        let legacyIndex = 0;
        for (const line of text.split("\n")) {
            if (line.trim().length === 0)
                continue;
            const value = safeJson(line);
            const header = logHeader(value);
            if (header !== null) {
                declaredNext = Math.max(declaredNext, header);
                continue;
            }
            const entry = storedFrame(value);
            if (entry !== undefined) {
                frames.push(entry);
                continue;
            }
            const legacy = frameSchema.safeParse(value);
            if (legacy.success) {
                frames.push({ index: legacyIndex, frame: legacy.data });
                legacyIndex += 1;
            }
        }
        let nextIndex = declaredNext;
        for (const entry of frames)
            nextIndex = Math.max(nextIndex, entry.index + 1);
        return { frames, nextIndex };
    }
    async appendLine(path, value) {
        await mkdir(this.directory, { recursive: true });
        await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
    }
    framePath(workspaceId) {
        return join(this.directory, `${workspaceId}.frames.jsonl`);
    }
    rolePath(workspaceId) {
        return join(this.directory, `${workspaceId}.roles.jsonl`);
    }
    invitePath(workspaceId) {
        return join(this.directory, `${workspaceId}.invites.jsonl`);
    }
    keyPath(workspaceId) {
        return join(this.directory, `${workspaceId}.keys.jsonl`);
    }
    removalPath(workspaceId) {
        return join(this.directory, `${workspaceId}.removed.jsonl`);
    }
}
/** The stored form of one frame: its position, and the ciphertext frame beside it. */
function storedLine(entry) {
    return { type: "frame", index: entry.index, frame: entry.frame };
}
function storedFrame(value) {
    if (typeof value !== "object" || value === null)
        return undefined;
    const record = value;
    if (record.type !== "frame")
        return undefined;
    const index = record.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0)
        return undefined;
    const parsed = frameSchema.safeParse(record.frame);
    return parsed.success ? { index, frame: parsed.data } : undefined;
}
/** The next position a file records, or null for a file that predates the record. */
function logHeader(value) {
    if (typeof value !== "object" || value === null)
        return null;
    const record = value;
    if (record.type !== "log")
        return null;
    const nextIndex = record.nextIndex;
    return typeof nextIndex === "number" && Number.isInteger(nextIndex) && nextIndex >= 0
        ? nextIndex
        : null;
}
async function readLines(path, parse) {
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch (error) {
        if (isMissingFile(error))
            return [];
        throw error;
    }
    const values = [];
    for (const line of text.split("\n")) {
        if (line.trim().length === 0)
            continue;
        const parsed = parse(safeJson(line));
        if (parsed !== undefined)
            values.push(parsed);
    }
    return values;
}
function pinnedKey(value) {
    if (typeof value !== "object" || value === null)
        return undefined;
    const record = value;
    if (typeof record.deviceId !== "string" || typeof record.publicKey !== "string")
        return undefined;
    const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "a device";
    return {
        deviceId: record.deviceId,
        publicKey: record.publicKey,
        name,
        ...(invitedWith(record.invitedWith) ?? {}),
    };
}
/** The invitation a device spent, when the file still has one it can read. */
function invitedWith(value) {
    if (typeof value !== "object" || value === null)
        return undefined;
    const record = value;
    const role = memberRoleSchema.safeParse(record.role);
    if (typeof record.inviteId !== "string" || !role.success)
        return undefined;
    return { invitedWith: { inviteId: record.inviteId, role: role.data } };
}
function safeJson(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
function isMissingFile(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT");
}
//# sourceMappingURL=store.js.map