/**
 * The build is local. There is one profile.
 *
 * The canvas used to ship three: a static standalone build, a self-hosted relay
 * and a hosted paid build. The relay and the hosted tier are gone, so what
 * remains is the one that always worked without a server: a document in this
 * app, on this machine, with the file as the only copy that matters.
 *
 * `VITE_SUITE_MODE` still names the compile-time switch because bundles inline
 * it, and two surfaces compare it to `standalone`; nothing here reads it.
 */

/**
 * Fragment marker left behind once a share token has been exchanged for the
 * session cookie. Mirrors `SHARE_SESSION_FRAGMENT` in `shares.ts`; it is copied
 * rather than imported so this module never pulls in the share client.
 */
const SHARE_SESSION_MARKER = "#share-session";

/**
 * True, always: the app is local.
 *
 * Every call site asks "may this reach the relay?" — attachments, sketch files,
 * video, templates, the share session. The answer is now the same everywhere, and
 * the branches behind it are unreachable. They are kept until each is deleted
 * with its feature, because removing the gate before the code behind it is how
 * an app starts offering a button whose service is gone.
 */
export function isStandalone(): boolean {
  return true;
}

/** Query and fragment of a page URL; relative URLs resolve against a placeholder. */
function parsePageUrl(url: string): URL | null {
  try {
    return new URL(url, "http://suite.invalid");
  } catch {
    return null;
  }
}

/**
 * True when `url` carries a share link, or the marker a resolved link leaves behind.
 *
 * The launcher uses it to say "this build is local" instead of pretending a dead
 * link works.
 */
export function hasShareLink(url: string): boolean {
  const parsed = parsePageUrl(url);
  if (!parsed) return false;
  return parsed.searchParams.has("share") || parsed.hash === SHARE_SESSION_MARKER;
}
