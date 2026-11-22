/**
 * Version compatibility for the shared vocabulary.
 *
 * A contract change that an older app cannot read is a major bump, and a major
 * bump is a coordinated release: the hub refuses the pair and says so, rather
 * than handing an app a manifest shape it will silently misread.
 *
 * The rules are the usual semver ones, written here rather than taken from a
 * package because the whole surface is a hundred lines and a dependency that
 * every app installs is worse than the hundred lines.
 */
/**
 * The contract version this build of the packages implements.
 *
 * 1.1.0 added an optional `settings` list to the widget descriptor and to the capture
 * payload. Both are additive: a manifest written before it still parses, and a capture
 * with no `settings` gets an empty record. A manifest that uses settings declares 1.1.0,
 * so a 1.0.0 host refuses the pair instead of meeting a field it does not know.
 */
export declare const CONTRACT_VERSION = "1.1.0";
/** A parsed version. `prerelease` is the dotted identifier, or null for a release. */
export interface Semver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
}
/** Parse a version, or null when it is not semver. */
export declare function parseSemver(value: string): Semver | null;
/** Standard semver ordering: negative when `left` precedes `right`. */
export declare function compareSemver(left: Semver, right: Semver): number;
/**
 * Whether a thing that requires `required` can run against `available`.
 *
 * Same major and `required <= available`. A newer minor is additive by
 * definition, so an app that asks for 1.2.0 runs on 1.4.0; an app that asks for
 * 2.0.0 does not, whatever is available in the 1.x line.
 */
export declare function isContractCompatible(required: string, available?: string): boolean;
//# sourceMappingURL=contractVersion.d.ts.map