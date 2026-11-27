/** What the card says about the pack's install state, in one word. */
export type PackStatus = "installed" | "update" | "available" | "unavailable";
export interface PackCardProps {
    readonly name: string;
    readonly description?: string;
    /** The pack card's icon, as a data URI. Absent draws the pack's initial. */
    readonly icon?: string;
    readonly status?: PackStatus;
    readonly version?: string;
    /** The card is the one whose details the rail is showing. */
    readonly selected?: boolean;
    readonly onSelect: () => void;
}
/**
 * One pack in a host's catalogue.
 *
 * The card is a chooser, not a launcher: choosing it shows the pack's details and its one action
 * in the rail, which is where versions, publishers and capabilities live. A person scanning Home
 * should see a mark, a name and a sentence — not a fingerprint.
 */
export declare function PackCard({ name, description, icon, status, version, selected, onSelect, }: PackCardProps): import("react").JSX.Element;
//# sourceMappingURL=PackCard.d.ts.map