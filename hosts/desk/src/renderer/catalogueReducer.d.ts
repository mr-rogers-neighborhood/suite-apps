export function compareVersions(left: string, right: string): -1 | 0 | 1;

export function highestCatalogueEntries<
  T extends { readonly id: string; readonly version: string },
>(catalogue: readonly T[], installedIds: ReadonlySet<string>): T[];

export function highestTrustedUpdate<
  T extends {
    readonly id: string;
    readonly version: string;
    readonly trusted: boolean;
    readonly platform?: { readonly state: string };
  },
>(catalogue: readonly T[], pack: { readonly id: string; readonly version: string }): T | undefined;
