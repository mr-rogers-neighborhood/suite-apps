export function openWorkspace(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("a workspace needs a path");
  }
  return trimmed;
}

export function closeWorkspace(handle: { close: () => void }): void {
  handle.close();
}
