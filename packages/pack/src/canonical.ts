/**
 * The canonical-JSON rules the manifest and the catalogue index share (S3.3).
 *
 * A signature is only meaningful when both sides serialise the same document the same way. The
 * rules live here once, rather than once per document: a fixed field order chosen by the caller,
 * an absent optional field contributing no key, nested object keys in code-unit order, and a
 * duplicate-key refusal before `JSON.parse` can keep the last one. Array order stays an authoring
 * decision unless the caller sorts it.
 */

/** UTF-16 code-unit order: stable everywhere, and it needs no locale data. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Rebuild an object with code-unit-sorted keys, dropping only `undefined`. */
export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareCodeUnits)) {
      if (source[key] === undefined) continue;
      ordered[key] = canonicalJsonValue(source[key]);
    }
    return ordered;
  }
  return value;
}

export interface DuplicateJsonKey {
  readonly key: string;
  readonly path: string;
}

type JsonFrame =
  | { readonly kind: "object"; readonly path: readonly string[]; readonly keys: Set<string> }
  | { readonly kind: "array"; readonly path: readonly string[]; index: number };

function isJsonWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

/**
 * A duplicate key in raw JSON text, or `null`.
 *
 * `JSON.parse` keeps the last of two identical keys without a word, so a document could show one
 * field to a verifier and another to whatever reads it next. Invalid JSON is left to `JSON.parse`
 * to refuse; this scan only reports a repeated key with its path.
 */
export function findDuplicateJsonKey(text: string): DuplicateJsonKey | null {
  const frames: JsonFrame[] = [];
  let pendingKey: string | null = null;
  let index = 0;

  const parentPath = (): readonly string[] => {
    const parent = frames[frames.length - 1];
    if (parent === undefined) return [];
    if (parent.kind === "array") return [...parent.path, String(parent.index)];
    return pendingKey === null ? parent.path : [...parent.path, pendingKey];
  };

  const skipWhitespace = (): void => {
    while (isJsonWhitespace(text[index])) index += 1;
  };

  const readString = (): string => {
    // `index` names the opening quote.
    index += 1;
    let value = "";
    while (index < text.length) {
      const character = text[index] as string;
      if (character === '"') {
        index += 1;
        return value;
      }
      if (character !== "\\") {
        value += character;
        index += 1;
        continue;
      }
      const escaped = text[index + 1];
      index += 2;
      switch (escaped) {
        case '"':
          value += '"';
          break;
        case "\\":
          value += "\\";
          break;
        case "/":
          value += "/";
          break;
        case "b":
          value += "\b";
          break;
        case "f":
          value += "\f";
          break;
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "u": {
          const code = text.slice(index, index + 4);
          if (/^[0-9A-Fa-f]{4}$/u.test(code)) {
            value += String.fromCharCode(Number.parseInt(code, 16));
            index += 4;
          }
          break;
        }
        default:
          break;
      }
    }
    return value;
  };

  while (index < text.length) {
    skipWhitespace();
    const character = text[index];
    if (character === undefined) break;

    if (character === "{" || character === "[") {
      const path = parentPath();
      if (character === "{") {
        frames.push({ kind: "object", path, keys: new Set() });
      } else {
        frames.push({ kind: "array", path, index: 0 });
      }
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      frames.pop();
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === ",") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "array") frame.index += 1;
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === ":") {
      index += 1;
      continue;
    }

    if (character === '"') {
      const value = readString();
      let ahead = index;
      while (isJsonWhitespace(text[ahead])) ahead += 1;
      if (text[ahead] === ":") {
        const frame = frames[frames.length - 1];
        if (frame?.kind === "object") {
          if (frame.keys.has(value)) {
            return { key: value, path: [...frame.path, value].join(".") };
          }
          frame.keys.add(value);
        }
        pendingKey = value;
        index = ahead + 1;
      }
      continue;
    }

    // A number or one of `true`, `false`, `null`: skip it. `JSON.parse` judges its shape.
    index += 1;
  }

  return null;
}
