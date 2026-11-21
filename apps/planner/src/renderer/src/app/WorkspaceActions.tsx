import { Button, type ButtonVariant } from "@suite/ui";
import { Download, Upload } from "lucide-react";

import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";

/**
 * Export and import, in one place.
 *
 * The rail footer and the menu bar both offer them, at different widths; sharing the two calls
 * keeps their wording and their error handling the same.
 */
export function WorkspaceActions({
  className,
  variant = "secondary",
  grow = false,
}: {
  readonly className?: string;
  readonly variant?: ButtonVariant;
  /** Rail buttons divide the footer between them; the bar's do not. */
  readonly grow?: boolean;
}) {
  const setNotice = useUiStore((state) => state.setNotice);

  async function exportWorkspace(): Promise<void> {
    try {
      const result = await getBridge().exportWorkspace();
      if (!result.canceled) setNotice(`Exported to ${result.path ?? "your chosen file"}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function importWorkspace(): Promise<void> {
    try {
      const result = await getBridge().importWorkspace();
      if (!result.canceled) setNotice("Workspace imported");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed");
    }
  }

  return (
    <div className={className}>
      <Button
        size="sm"
        variant={variant}
        className={grow ? "flex-1" : undefined}
        onClick={() => void exportWorkspace()}
      >
        <Download size={13} />
        Export
      </Button>
      <Button
        size="sm"
        variant={variant}
        className={grow ? "flex-1" : undefined}
        onClick={() => void importWorkspace()}
      >
        <Upload size={13} />
        Import
      </Button>
    </div>
  );
}
