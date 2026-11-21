export declare function encodeBase64(bytes: Uint8Array): string;
/** Decode base64, or null when a character is outside the alphabet. */
export declare function decodeBase64(value: string): Uint8Array | null;
/**
 * URL-safe base64 for a payload that travels in a link.
 *
 * A signed invitation is JSON, so the standard alphabet's `+` and `/` would be
 * percent-encoded by `URLSearchParams` and make an already long link longer. The
 * padding is dropped for the same reason; `decodeBase64Url` puts it back.
 */
export declare function encodeBase64Url(bytes: Uint8Array): string;
/**
 * Decode URL-safe base64, or null when the text is not the canonical encoding.
 *
 * The standard decoder is deliberately forgiving about leftover bits; a link is not.
 * Re-encoding and comparing rejects a value whose trailing bits another spelling could
 * have produced, so one payload has exactly one link form.
 */
export declare function decodeBase64Url(value: string): Uint8Array | null;
//# sourceMappingURL=base64.d.ts.map