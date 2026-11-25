/**
 * The Electron shell's renderer entry.
 *
 * The renderer is pack-owned, so this file and the shell's `index.html` in front
 * of it are the two things left here: the window loads the same `main.tsx` the
 * pack does, and there is no second copy of the app to drift from it.
 */
import "../../../packs/canvas/src/main";
