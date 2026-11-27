export interface PackRailAction {
    readonly label: string;
    readonly onSelect: () => void;
}
export interface PackRailScreenshot {
    readonly src: string;
    readonly alt: string;
}
export interface PackRailDetail {
    readonly label: string;
    readonly value: string;
}
export interface PackRailPack {
    readonly name: string;
    readonly description?: string;
    /** The pack card's icon, as a data URI. */
    readonly icon?: string;
    /** One line under the name: "Installed · 0.4.3", "Available · 0.4.4". */
    readonly status?: string;
    /** A warning about this build's ability to draw the pack. */
    readonly note?: string;
    readonly primary: {
        readonly label: string;
        readonly onSelect: () => void;
        readonly disabled?: boolean;
    };
    readonly actions?: readonly PackRailAction[];
    readonly screenshots?: readonly PackRailScreenshot[];
    /** The technical record: version, source, publisher, key, capabilities, signature. */
    readonly details: readonly PackRailDetail[];
}
export interface PackRailProps {
    readonly pack: PackRailPack | null;
    readonly onClose: () => void;
}
/**
 * A pack's page in the host's right rail.
 *
 * Choosing a pack in the catalogue shows this: what it is, what it looks like, and the one thing
 * to do with it. Everything a person does not need in order to decide — the publisher id, the key
 * fingerprint, the capability names, the archive source — sits behind **More details**, so the
 * face of the app never reads like an audit log.
 */
export declare function PackRail({ pack, onClose }: PackRailProps): import("react").JSX.Element | null;
//# sourceMappingURL=PackRail.d.ts.map