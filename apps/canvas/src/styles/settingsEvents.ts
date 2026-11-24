/** A window event: any surface can ask for Settings without owning its state. */
export const SETTINGS_EVENT = "suite:settings-open";

/** Opens Settings from anywhere that is not already inside the dialog. */
export function openSettings(): void {
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}
