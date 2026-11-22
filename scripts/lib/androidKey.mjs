/**
 * The Android release key: where it lives, whether it is the one this tree pins, and how to make one.
 *
 * The pack and update keys are Ed25519 keypairs in the same directory, but an Android release key
 * cannot join them: it is a JKS/PKCS#12 keystore with a password, and Android identifies it by the
 * SHA-256 digest of its certificate. Folding it into `KEYS` would mean teaching `inspectKey` a second
 * algorithm and a secret the file itself does not carry. It is a separate check instead:
 *
 *   pnpm android:key status
 *
 * Two facts make the check worth running before a build. Android refuses an update signed by a
 * different certificate, so a build machine holding the wrong key produces an APK nobody can install
 * over the last one. And the debug keystore signs perfectly well, so a misconfigured release would
 * look finished. The pin is the certificate digest; the script refuses an APK that does not carry it.
 *
 * The private half and its password live outside the repository, in the Suite key directory:
 *
 *   <keys>/suite-go-release.jks    PKCS#12, mode 0600
 *   <keys>/suite-go-release.pass   the store password, mode 0600
 *
 * `SUITE_GO_KEYSTORE`, `SUITE_GO_KEYSTORE_PASSWORD`, `SUITE_GO_KEY_ALIAS` and `SUITE_GO_KEY_PASSWORD`
 * still name a keystore elsewhere, which is what another machine or a test uses. The alias is fixed
 * unless overridden, so a rebuilt key is still found.
 *
 * Importing this file reads nothing and writes nothing.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { keysDir } from "./keys.mjs";

/** The keystore file inside the Suite key directory. */
export const ANDROID_KEYSTORE_FILE = "suite-go-release.jks";

/** The password file beside it. It is a separate file so the keystore is a keystore, not a blob. */
export const ANDROID_PASSWORD_FILE = "suite-go-release.pass";

/** The alias every build asks keytool for. */
export const ANDROID_KEY_ALIAS = "suite-go";

/** The environment variables the release build reads. Gradle reads the same four. */
export const ANDROID_KEYSTORE_ENV = "SUITE_GO_KEYSTORE";
export const ANDROID_KEYSTORE_PASSWORD_ENV = "SUITE_GO_KEYSTORE_PASSWORD";
export const ANDROID_KEY_ALIAS_ENV = "SUITE_GO_KEY_ALIAS";
export const ANDROID_KEY_PASSWORD_ENV = "SUITE_GO_KEY_PASSWORD";

/**
 * The certificate SHA-256 digest this tree signs with, lowercase hex.
 *
 * A pin is a trust root: Android compares the certificate of an update against the installed app, so
 * an APK signed by any other key is refused on a phone that already has Suite Go. `pnpm android:key
 * status` prints this and the key in hand; `scripts/android-release.mjs` refuses a build whose
 * certificate is not this one, before it names or uploads anything.
 */
export const ANDROID_RELEASE_CERT_SHA256 =
  "221c6e4bdcbd1323f571eef58bdbd9d09f35ec1a33f404ea2f63e1216366d14f";

/** Where the keystore is read from. */
export function androidKeystorePath(env = process.env) {
  const override = env[ANDROID_KEYSTORE_ENV]?.trim();
  return override ? override : join(keysDir(env), ANDROID_KEYSTORE_FILE);
}

/** Where the store password is read from when the environment does not name one. */
export function androidPasswordPath(env = process.env) {
  return join(keysDir(env), ANDROID_PASSWORD_FILE);
}

/**
 * The store password, or null.
 *
 * The environment wins, because that is how a CI machine or a test supplies one without writing a
 * secret to disk. The file is the default for a person, and a trailing newline is not part of it.
 */
export function readStorePassword(env = process.env) {
  const fromEnv = env[ANDROID_KEYSTORE_PASSWORD_ENV];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  try {
    const text = readFileSync(androidPasswordPath(env), "utf8").replace(/\r?\n$/u, "");
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** The key alias in use. */
export function readKeyAlias(env = process.env) {
  const alias = env[ANDROID_KEY_ALIAS_ENV]?.trim();
  return alias && alias.length > 0 ? alias : ANDROID_KEY_ALIAS;
}

/** The key password, which defaults to the store password for a PKCS#12 keystore. */
export function readKeyPassword(env = process.env) {
  const fromEnv = env[ANDROID_KEY_PASSWORD_ENV];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return readStorePassword(env);
}

/** keytool from the JDK Gradle will use, or `keytool` on PATH when no JDK was resolved. */
export function keytoolFor(jdk) {
  return jdk === null || jdk === undefined ? "keytool" : join(jdk, "bin", "keytool");
}

/** A digest as lowercase hex with no separators, whatever form it arrived in. */
export function normaliseFingerprint(text) {
  return String(text ?? "")
    .replace(/[^0-9a-fA-F]/gu, "")
    .toLowerCase();
}

/** The grouped form a person reads aloud, `ab:cd:…`. */
export function groupedFingerprint(hex) {
  const pairs = normaliseFingerprint(hex).match(/.{2}/gu) ?? [];
  return pairs.join(":").toUpperCase();
}

/** The fingerprint a pin names, normalised for comparison. */
export function pinnedFingerprint() {
  return normaliseFingerprint(ANDROID_RELEASE_CERT_SHA256);
}

/**
 * The SHA-256 digest of the certificate keytool exports, lowercase hex.
 *
 * `keytool -exportcert` writes DER to stdout, so the digest is computed over exactly the bytes
 * Android hashes. Parsing the human fingerprint out of `-list -v` would depend on the JDK's locale;
 * this does not.
 */
export function certificateSha256({ keytool, keystore, password, alias }) {
  const result = spawnSync(
    keytool,
    [
      "-exportcert",
      "-keystore",
      keystore,
      "-storepass",
      password,
      "-alias",
      alias,
    ],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );

  if (result.error) {
    return { fingerprint: null, detail: `${keytool}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : String(result.stderr ?? "").trim();
    return { fingerprint: null, detail: stderr || `${keytool} exited ${result.status}` };
  }
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    return { fingerprint: null, detail: "keytool exported no certificate" };
  }
  return {
    fingerprint: createHash("sha256").update(result.stdout).digest("hex"),
    detail: null,
  };
}

/**
 * Everything a person or a script needs about the release key, without printing the secret.
 *
 * States:
 *
 *   absent      no keystore on this machine; a clean checkout is not a fault
 *   no-password the keystore is there but neither the environment nor the file carries a password
 *   no-keytool  the JDK has no keytool, so the certificate cannot be read
 *   unreadable  keytool refused the keystore, alias or password
 *   unpinned    the pin is a placeholder; a build must not proceed until one is recorded
 *   matches     this key signs the certificate the tree trusts
 *   mismatch    this key signs something Android refuses as an update
 */
export function inspectAndroidKey({ env = process.env, jdk = null } = {}) {
  const path = androidKeystorePath(env);
  const passwordPath = androidPasswordPath(env);
  const password = readStorePassword(env);
  const alias = readKeyAlias(env);
  const keytool = keytoolFor(jdk);
  const pin = pinnedFingerprint();

  const base = { path, passwordPath, alias, keytool, pin };

  if (!existsSync(path)) {
    return { ...base, state: "absent", ok: true, fingerprint: null, detail: "not present" };
  }
  if (password === null) {
    return {
      ...base,
      state: "no-password",
      ok: false,
      fingerprint: null,
      detail: `no password: set ${ANDROID_KEYSTORE_PASSWORD_ENV} or write ${passwordPath}`,
    };
  }

  const exported = certificateSha256({ keytool, keystore: path, password, alias });
  if (exported.fingerprint === null) {
    return {
      ...base,
      state: "unreadable",
      ok: false,
      fingerprint: null,
      detail: exported.detail,
    };
  }

  if (pin.length !== 64) {
    return {
      ...base,
      state: "unpinned",
      ok: false,
      fingerprint: exported.fingerprint,
      detail: "ANDROID_RELEASE_CERT_SHA256 in scripts/lib/androidKey.mjs is a placeholder",
    };
  }

  const matches = exported.fingerprint === pin;
  return {
    ...base,
    state: matches ? "matches" : "mismatch",
    ok: matches,
    fingerprint: exported.fingerprint,
    detail: matches
      ? "matches ANDROID_RELEASE_CERT_SHA256"
      : "does not match ANDROID_RELEASE_CERT_SHA256",
  };
}

/**
 * The four variables Gradle reads, from the keystore this machine has.
 *
 * Returns null when the key is not present or has no password, so the caller refuses before Gradle
 * can produce an unsigned artifact that looks finished.
 */
export function signingEnvironment({ env = process.env, key } = {}) {
  const inspected = key ?? inspectAndroidKey({ env });
  const password = readStorePassword(env);
  const keyPassword = readKeyPassword(env);
  if (inspected.state === "absent" || password === null || keyPassword === null) return null;
  return {
    [ANDROID_KEYSTORE_ENV]: inspected.path,
    [ANDROID_KEYSTORE_PASSWORD_ENV]: password,
    [ANDROID_KEY_ALIAS_ENV]: inspected.alias,
    [ANDROID_KEY_PASSWORD_ENV]: keyPassword,
  };
}

/**
 * Make the one release keystore this project has, and print only what is public.
 *
 * The password is generated here (32 random bytes, base64) and written beside the keystore with mode
 * 0600. It is never printed. `--force` replaces an existing keystore, which invalidates every
 * installed build's update path: Android refuses an update signed by a different certificate, so the
 * old app has to be uninstalled first.
 */
export function generateAndroidKey({ env = process.env, jdk = null, force = false } = {}) {
  const path = androidKeystorePath(env);
  const passwordPath = androidPasswordPath(env);
  const keytool = keytoolFor(jdk);
  const alias = readKeyAlias(env);

  if (existsSync(path) && !force) {
    throw new Error(
      `${path} already exists. A second key would leave one of them unrecorded; ` +
        "pass --force only if every installed build is disposable.",
    );
  }

  const supplied = env[ANDROID_KEYSTORE_PASSWORD_ENV];
  const password =
    typeof supplied === "string" && supplied.length > 0
      ? supplied
      : randomBytes(32).toString("base64url");

  mkdirSync(keysDir(env), { recursive: true, mode: 0o700 });
  chmodSync(keysDir(env), 0o700);

  writeFileSync(passwordPath, `${password}\n`, { mode: 0o600 });
  chmodSync(passwordPath, 0o600);

  const result = spawnSync(
    keytool,
    [
      "-genkeypair",
      "-keystore",
      path,
      "-storetype",
      "PKCS12",
      "-alias",
      alias,
      "-keyalg",
      "RSA",
      "-keysize",
      "4096",
      "-validity",
      "10000",
      "-storepass",
      password,
      "-keypass",
      password,
      "-dname",
      "CN=Suite Go, OU=Mobile, O=Suite, C=US",
    ],
    { encoding: "utf8" },
  );

  if (result.error) throw new Error(`${keytool}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${keytool} exited ${result.status}:\n${String(result.stderr ?? "").trim()}`);
  }
  chmodSync(path, 0o600);
  const exported = certificateSha256({ keytool, keystore: path, password, alias });
  if (exported.fingerprint === null) {
    throw new Error(`wrote ${path} but could not read its certificate: ${exported.detail}`);
  }

  return {
    path,
    passwordPath,
    alias,
    fingerprint: exported.fingerprint,
    mode: statSync(path).mode & 0o777,
  };
}
