/**
 * Where an attachment's bytes would be fetched from, for the paths that still
 * build that URL.
 *
 * The hosted build served `/api` from the page's own origin, so a production
 * build without `VITE_COLLAB_*` was still usable. That build is gone; what
 * survives is the attachment URL the editor's schema builds in both profiles.
 */

/** Matches the collab server's default port in development. */
const DEV_HTTP_URL = "http://localhost:1235";

type PageLocation = Pick<Location, "origin">;

function envValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pageLocation(): PageLocation | null {
  return typeof window === "undefined" ? null : window.location;
}

/**
 * Base URL for `/api` requests. The production fallback is the page origin, so
 * requests stay same-origin and CORS is not involved at all.
 */
export function collabHttpBase(location: PageLocation | null = pageLocation()): string {
  const configured = envValue(import.meta.env.VITE_COLLAB_HTTP_URL);
  if (configured !== null) return configured.replace(/\/+$/u, "");
  if (import.meta.env.DEV) return DEV_HTTP_URL;
  return location?.origin ?? "";
}
