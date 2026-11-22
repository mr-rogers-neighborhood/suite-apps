import { ScreenDocument } from "./document.js";
import homeScreenFixture from "./fixtures/home.screen.json" with { type: "json" };
import { parseScreen, type Screen } from "./screen.js";

/**
 * One shared composition for both host renderers.
 *
 * The JSON file is the fixture the desktop host and Start can load later; it is not a
 * second schema. This module is only the conversion from that JSON to the Loro document,
 * so neither host writes its own loader and the two cannot drift apart.
 */

export const HOME_SCREEN_FIXTURE: unknown = homeScreenFixture;

/** The fixture as a parsed Screen. Throws only if the committed fixture is broken. */
export function homeScreen(): Screen {
  const parsed = parseScreen(homeScreenFixture);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

/** The fixture as a fresh Loro document. */
export function homeScreenDocument(): ScreenDocument {
  return ScreenDocument.create(homeScreen());
}
