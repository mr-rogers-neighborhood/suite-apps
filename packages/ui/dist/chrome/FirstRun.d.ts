import { type Density, type ThemeMode } from "@suite/theme";
import { type PackStatus } from "./PackCard.js";
/**
 * First run.
 *
 * A host surface, not a pack and not a Screen: choose the apps, choose how Suite looks, watch
 * them install, then hand the person to an empty Home. The host owns the catalogue, the theme
 * and the installer; this component owns the question and its progress.
 */
export type FirstRunStep = "apps" | "appearance" | "install";
export type FirstRunMode = ThemeMode | "system";
export interface FirstRunPack {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly version?: string;
    readonly status?: PackStatus;
    /** What the catalogue showed: who signed it and which capabilities it declares. */
    readonly publisher?: string;
    readonly capabilities?: readonly string[];
}
export interface FirstRunTheme {
    readonly preset: string;
    /** `system` keeps following the OS; the host resolves light or dark for the paint. */
    readonly mode: FirstRunMode;
    readonly density: Density;
}
export interface FirstRunInstall {
    readonly id: string;
    readonly ok: boolean;
    readonly detail: string;
}
export interface FirstRunRow {
    readonly id: string;
    readonly state: "queued" | "installing" | "installed" | "failed";
    readonly detail: string;
}
export interface FirstRunProps {
    readonly packs: readonly FirstRunPack[];
    readonly theme: FirstRunTheme;
    readonly onThemeChange: (theme: FirstRunTheme) => void;
    /** Install one pack. The component calls these concurrently, one per selected pack. */
    readonly onInstall: (id: string) => Promise<FirstRunInstall>;
    /** Leave the wizard. The host shows the empty Home only after this returns. */
    readonly onComplete: () => void | Promise<void>;
    /** Story and resumed-flow seams; the host omits both on a fresh install. */
    readonly initialStep?: FirstRunStep;
    readonly initialSelected?: readonly string[];
    readonly initialRows?: readonly FirstRunRow[];
}
export declare function FirstRun({ packs, theme, onThemeChange, onInstall, onComplete, initialStep, initialSelected, initialRows, }: FirstRunProps): import("react").JSX.Element;
//# sourceMappingURL=FirstRun.d.ts.map