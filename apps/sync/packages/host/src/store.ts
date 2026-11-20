import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Frame,
  frameSchema,
  type InviteRecord,
  inviteRecordSchema,
  type MemberRole,
  memberRoleSchema,
  type RemovalRecord,
  type RoleRecord,
  removalRecordSchema,
  roleRecordSchema,
} from "@suite/sync";

/**
 * One frame with the position the host assigned it.
 *
 * The position is stored beside the frame rather than inferred from the frame's place in
 * the array. Retention drops the oldest entries, and a client that reconnects must still
 * see the positions it already applied; renumbering the survivors would move its cursor
 * without telling it.
 */
export interface StoredFrame {
  readonly index: number;
  readonly frame: Frame;
}

/**
 * What a host keeps between process lifetimes: frames, and who may write.
 *
 * Frames are ciphertext and role records are signed public metadata — a device id and a
 * role, no content — so neither needs a key to sit on disk. The host reads the header of
 * a role record because it has to; it never reads a frame.
 *
 * Role records must be kept. A host that forgot them would refuse every frame after a
 * restart, which looks exactly like a broken workspace.
 */
export interface HostStore {
  loadFrames(workspaceId: string): Promise<readonly StoredFrame[]>;
  /**
   * The position the next frame will take.
   *
   * Kept even when no frame is held: compaction can empty the log, and a client's cursor
   * must not be moved back to zero by a process that starts again afterwards.
   */
  loadNextIndex(workspaceId: string): Promise<number>;
  appendFrame(workspaceId: string, entry: StoredFrame): Promise<void>;
  loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
  appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
  /** Invites an owner wrote. They expire, so they are kept as records rather than as grants. */
  loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
  appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
  /** The public key a device joined with, so its signature can be checked after a restart. */
  loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
  appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
  /**
   * Devices an owner has taken out.
   *
   * Kept for the same reason role records are: a host that forgot would keep forwarding a
   * removed device's mail, and would accept it back after a restart as if nothing happened.
   */
  loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]>;
  appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void>;
  /** Forget frames that arrived before `cutoff`. A rewrite, so it runs when a window closes. */
  compact(workspaceId: string, cutoff: string): Promise<void>;
}

export interface PinnedKey {
  readonly deviceId: string;
  readonly publicKey: string;
  /** The name the device introduced itself with. */
  readonly name: string;
  /**
   * The invitation this device spent, if it spent one, and the role that invitation granted.
   *
   * Kept because the person adding the device may not have been connected when it asked, and
   * the invitation is spent the moment the key package lands. Without this a join that waited
   * for the owner would wait forever, and the honest answer to "why is it stuck" would be
   * "nobody remembers what it asked for".
   */
  readonly invitedWith?: { readonly inviteId: string; readonly role: MemberRole };
}

export class MemoryHostStore implements HostStore {
  private readonly frames = new Map<string, StoredFrame[]>();
  private readonly nextIndex = new Map<string, number>();
  private readonly invites = new Map<string, InviteRecord[]>();
  private readonly roles = new Map<string, RoleRecord[]>();
  private readonly keys = new Map<string, PinnedKey[]>();
  private readonly removals = new Map<string, RemovalRecord[]>();

  async loadFrames(workspaceId: string): Promise<readonly StoredFrame[]> {
    return [...(this.frames.get(workspaceId) ?? [])];
  }

  async loadNextIndex(workspaceId: string): Promise<number> {
    return this.nextIndex.get(workspaceId) ?? 0;
  }

  async appendFrame(workspaceId: string, entry: StoredFrame): Promise<void> {
    const existing = this.frames.get(workspaceId) ?? [];
    existing.push(entry);
    this.frames.set(workspaceId, existing);
    this.nextIndex.set(
      workspaceId,
      Math.max(this.nextIndex.get(workspaceId) ?? 0, entry.index + 1),
    );
  }

  async loadRoles(workspaceId: string): Promise<readonly RoleRecord[]> {
    return [...(this.roles.get(workspaceId) ?? [])];
  }

  async appendRole(workspaceId: string, record: RoleRecord): Promise<void> {
    const existing = this.roles.get(workspaceId) ?? [];
    existing.push(record);
    this.roles.set(workspaceId, existing);
  }

  async loadInvites(workspaceId: string): Promise<readonly InviteRecord[]> {
    return [...(this.invites.get(workspaceId) ?? [])];
  }

  async appendInvite(workspaceId: string, record: InviteRecord): Promise<void> {
    const existing = this.invites.get(workspaceId) ?? [];
    existing.push(record);
    this.invites.set(workspaceId, existing);
  }

  async loadKeys(workspaceId: string): Promise<readonly PinnedKey[]> {
    return [...(this.keys.get(workspaceId) ?? [])];
  }

  async appendKey(workspaceId: string, key: PinnedKey): Promise<void> {
    const existing = this.keys.get(workspaceId) ?? [];
    existing.push(key);
    this.keys.set(workspaceId, existing);
  }

  async loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]> {
    return [...(this.removals.get(workspaceId) ?? [])];
  }

  async appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void> {
    const existing = this.removals.get(workspaceId) ?? [];
    existing.push(record);
    this.removals.set(workspaceId, existing);
  }

  async compact(workspaceId: string, cutoff: string): Promise<void> {
    const kept = (this.frames.get(workspaceId) ?? []).filter(
      (entry) => entry.frame.receivedAt >= cutoff,
    );
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
export class FileHostStore implements HostStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async loadFrames(workspaceId: string): Promise<readonly StoredFrame[]> {
    return (await this.readLog(workspaceId)).frames;
  }

  async loadNextIndex(workspaceId: string): Promise<number> {
    return (await this.readLog(workspaceId)).nextIndex;
  }

  async appendFrame(workspaceId: string, entry: StoredFrame): Promise<void> {
    await this.appendLine(this.framePath(workspaceId), storedLine(entry));
  }

  async loadRoles(workspaceId: string): Promise<readonly RoleRecord[]> {
    return readLines(this.rolePath(workspaceId), (value) => roleRecordSchema.safeParse(value).data);
  }

  async appendRole(workspaceId: string, record: RoleRecord): Promise<void> {
    await this.appendLine(this.rolePath(workspaceId), record);
  }

  async loadInvites(workspaceId: string): Promise<readonly InviteRecord[]> {
    return readLines(
      this.invitePath(workspaceId),
      (value) => inviteRecordSchema.safeParse(value).data,
    );
  }

  async appendInvite(workspaceId: string, record: InviteRecord): Promise<void> {
    await this.appendLine(this.invitePath(workspaceId), record);
  }

  async loadKeys(workspaceId: string): Promise<readonly PinnedKey[]> {
    return readLines(this.keyPath(workspaceId), (value) => pinnedKey(value));
  }

  async appendKey(workspaceId: string, key: PinnedKey): Promise<void> {
    await this.appendLine(this.keyPath(workspaceId), key);
  }

  async loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]> {
    return readLines(this.removalPath(workspaceId), (value) => {
      const parsed = removalRecordSchema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    });
  }

  async appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void> {
    await this.appendLine(this.removalPath(workspaceId), record);
  }

  async compact(workspaceId: string, cutoff: string): Promise<void> {
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
  private async readLog(
    workspaceId: string,
  ): Promise<{ frames: StoredFrame[]; nextIndex: number }> {
    let text: string;
    try {
      text = await readFile(this.framePath(workspaceId), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return { frames: [], nextIndex: 0 };
      throw error;
    }

    const frames: StoredFrame[] = [];
    let declaredNext = 0;
    let legacyIndex = 0;
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
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
    for (const entry of frames) nextIndex = Math.max(nextIndex, entry.index + 1);
    return { frames, nextIndex };
  }

  private async appendLine(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
  }

  private framePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.frames.jsonl`);
  }

  private rolePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.roles.jsonl`);
  }

  private invitePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.invites.jsonl`);
  }

  private keyPath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.keys.jsonl`);
  }

  private removalPath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.removed.jsonl`);
  }
}

/** The stored form of one frame: its position, and the ciphertext frame beside it. */
function storedLine(entry: StoredFrame): { type: "frame"; index: number; frame: Frame } {
  return { type: "frame", index: entry.index, frame: entry.frame };
}

function storedFrame(value: unknown): StoredFrame | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== "frame") return undefined;
  const index = record.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  const parsed = frameSchema.safeParse(record.frame);
  return parsed.success ? { index, frame: parsed.data } : undefined;
}

/** The next position a file records, or null for a file that predates the record. */
function logHeader(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "log") return null;
  const nextIndex = record.nextIndex;
  return typeof nextIndex === "number" && Number.isInteger(nextIndex) && nextIndex >= 0
    ? nextIndex
    : null;
}

async function readLines<T>(path: string, parse: (value: unknown) => T | undefined): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const values: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = parse(safeJson(line));
    if (parsed !== undefined) values.push(parsed);
  }
  return values;
}

function pinnedKey(value: unknown): PinnedKey | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.deviceId !== "string" || typeof record.publicKey !== "string") return undefined;
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "a device";
  return {
    deviceId: record.deviceId,
    publicKey: record.publicKey,
    name,
    ...(invitedWith(record.invitedWith) ?? {}),
  };
}

/** The invitation a device spent, when the file still has one it can read. */
function invitedWith(value: unknown): Pick<PinnedKey, "invitedWith"> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const role = memberRoleSchema.safeParse(record.role);
  if (typeof record.inviteId !== "string" || !role.success) return undefined;
  return { invitedWith: { inviteId: record.inviteId, role: role.data } };
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
