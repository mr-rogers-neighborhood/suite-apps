import { App as NativeApp } from "@capacitor/app";
import type {
  CaptureIntent,
  DeviceKey,
  ModuleHost,
  ModuleViewProps,
  PackCapability,
  SuiteGoModule,
  ThemeDensity,
} from "@suite/go";
import { FIRST_PARTY_PUBLISHER_ID } from "@suite/go";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CatalogueEntry, createCatalogue } from "../host/catalogue.js";
import {
  CAPABILITY_REASONS,
  ConsentRecord,
  type ConsentView,
  keyValueConsentStorage,
} from "../host/consent.js";
import { createDocumentStore } from "../host/documents.js";
import { createFileService, mimeFor } from "../host/files.js";
import { createNotifications } from "../host/notifications.js";
import { createPackFiles, packFilesScopeOf } from "../host/packFiles.js";
import {
  createFilesystemIdentityStorage,
  createPackIdentity,
  openDeviceKey,
  refusedPackIdentity,
} from "../host/packIdentity.js";
import { createPackStore, type InstalledPack } from "../host/packs.js";
import { createPins, orderModules } from "../host/pins.js";
import { createRecents, type RecentEntry } from "../host/recents.js";
import { shelfFrom } from "../host/shelf.js";
import { createKeyValueStore } from "../host/storage.js";
import {
  closeTab,
  createTabStore,
  EMPTY_TABS,
  openTab,
  removeTabs,
  retainTabs,
  showHome,
  type TabState,
} from "../host/tabs.js";
import {
  applyDensity,
  setThemeChoice as applyThemeChoice,
  type GoThemeChoice,
  paintTheme,
  readDensity,
  readThemeChoice,
  resolveTheme,
  watchColorScheme,
} from "../host/theme.js";
import { scratchModule } from "../modules/scratch/index.js";
import { Catalogue } from "./Catalogue.js";
import { ConsentSheet } from "./ConsentSheet.js";
import { Home } from "./Home.js";
import { IsolatedModule } from "./IsolatedModule.js";
import { MountedModule } from "./MountedModule.js";
import { QuickCaptureSheet } from "./QuickCaptureSheet.js";
import { type SettingsApp, SettingsSheet } from "./SettingsSheet.js";
import { TabBar } from "./TabBar.js";

/**
 * The container.
 *
 * It holds a registry of declarations, one document store, open-app tabs and a
 * route. It imports one reference module (Scratch, development only); every
 * other app arrives as an installed pack.
 *
 * There is no branch on a domain id anywhere in this file. If one appears, the
 * container has started learning a domain.
 */

function packAsModule(
  pack: InstalledPack,
  onQuickCapture?: () => void,
  onExport?: (moduleId: string) => void,
  onConsent?: (capability: PackCapability) => Promise<boolean>,
): SuiteGoModule {
  const { id, name } = pack.manifest;
  let flushFrame: () => Promise<void> = async () => undefined;
  const acceptFlush = (flush: () => Promise<void>) => {
    flushFrame = flush;
  };
  const flush = async () => {
    try {
      await flushFrame();
    } catch (error) {
      console.error(`Suite Go: ${name} did not flush its document`, error);
    }
  };

  return {
    id,
    name,
    icon: "box",
    capabilities: ["documents"],
    accepts: [],
    register: () => ({
      view: ({ host }: ModuleViewProps) => (
        <IsolatedModule
          host={host}
          entryUrl={pack.entryUrl}
          title={name}
          manifest={pack.manifest}
          onFrameReady={acceptFlush}
          {...(onConsent ? { consent: onConsent } : {})}
          {...(onQuickCapture ? { onQuickCapture } : {})}
          {...(onExport ? { onExport: () => onExport(id) } : {})}
        />
      ),
      flush,
      dispose: flush,
    }),
  };
}

const documents = createDocumentStore();
const shellStorage = createKeyValueStore("shell");
const pins = createPins(shellStorage);
const recents = createRecents(shellStorage);
const files = createFileService();
const packs = createPackStore();
const catalogue = createCatalogue({ packs, store: createKeyValueStore("catalogue") });
const notifications = createNotifications();
const tabStore = createTabStore(shellStorage);
const consentStorage = keyValueConsentStorage(shellStorage);
const identityStorage = createFilesystemIdentityStorage();

/**
 * Dev handles, for `pnpm android:eval`.
 *
 * The catalogue is the screen a person uses now. These remain for device checks
 * that call a store directly — a signed file, a list, a removal — without
 * walking the UI.
 */
let reloadPacksFromDev: () => void = () => undefined;

Object.assign(globalThis, {
  __suiteGoDev: {
    reload: () => reloadPacksFromDev(),
    install: (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return packs.install(bytes);
    },
    list: () => packs.list(),
    setIdleRelease: (ms: number) => {
      IDLE_RELEASE_MS = ms;
    },
    uninstall: (id: string) => packs.uninstall(id),
  },
});
paintTheme();

/**
 * How long an inactive tab stays mounted before it is released and its edit
 * flushed. A `let` so `__suiteGoDev.setIdleRelease` can shorten it for a test.
 */
let IDLE_RELEASE_MS = 5 * 60_000;

type Route = { readonly kind: "home" } | { readonly kind: "catalogue" };

interface PendingConsent {
  readonly packName: string;
  readonly capability: PackCapability;
  readonly reason: string;
  readonly resolve: (granted: boolean) => void;
}

interface PackConsentIdentity {
  readonly publisherId: string;
  readonly packId: string;
  readonly version: string;
  readonly name: string;
}

export function App() {
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [tabs, setTabs] = useState<TabState>(EMPTY_TABS);
  const [mounted, setMounted] = useState<readonly string[]>([]);
  const [restored, setRestored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [installed, setInstalled] = useState<readonly InstalledPack[]>([]);
  const [catalogueEntries, setCatalogueEntries] = useState<readonly CatalogueEntry[]>([]);
  const [catalogueNotice, setCatalogueNotice] = useState<string | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinned, setPinned] = useState<readonly string[]>([]);
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeChoice, setThemeChoiceState] = useState<GoThemeChoice>(() => readThemeChoice());
  const [density, setDensityState] = useState<ThemeDensity>(() => readDensity());
  const [theme, setThemeTokens] = useState(() => resolveTheme());
  const [deviceKey, setDeviceKey] = useState<DeviceKey | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [consentVersion, setConsentVersion] = useState(0);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);

  const cleanups = useRef(new Map<string, () => Promise<void>>());
  const flushes = useRef(new Map<string, () => Promise<void>>());
  const idleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The frame bridge is built once per pack, while consent state changes. The
  // ref keeps the latest gate without rebuilding an installed pack's bridge.
  const askConsentRef = useRef<(moduleId: string, capability: PackCapability) => Promise<boolean>>(
    async () => false,
  );
  const exportDocumentRef = useRef<(moduleId: string) => void>(() => undefined);

  useEffect(() => watchColorScheme(setThemeTokens), []);

  const changeTheme = useCallback((choice: GoThemeChoice) => {
    setThemeChoiceState(choice);
    setThemeTokens(applyThemeChoice(choice));
  }, []);

  const changeDensity = useCallback((next: ThemeDensity) => {
    setDensityState(next);
    applyDensity(next);
    setThemeTokens(resolveTheme(next));
  }, []);

  const refreshRecents = useCallback(async () => {
    setRecent(await recents.list());
  }, []);

  const refresh = useCallback(async () => {
    setPinned(await pins.list());
    await refreshRecents();
    setInstalled(await packs.discover());
    setLoaded(true);
  }, [refreshRecents]);

  const reloadPacks = useCallback(async () => {
    setInstalled(await packs.discover());
  }, []);

  useEffect(() => {
    reloadPacksFromDev = () => void reloadPacks();
  }, [reloadPacks]);

  // The device key and the consent record are both async. Mounting a pack
  // before either is ready would expose a host surface that cannot answer.
  useEffect(() => {
    void openDeviceKey(identityStorage)
      .then(setDeviceKey)
      .catch((error: unknown) => {
        console.error("Suite Go: the device key could not be read", error);
      });
    void ConsentRecord.open(consentStorage).then(setConsent);
  }, []);

  const refreshCatalogue = useCallback(async () => {
    setCatalogueLoading(true);
    try {
      const result = await catalogue.load();
      if (!result.ok) {
        setCatalogueNotice(result.message);
        return;
      }
      setCatalogueEntries(result.entries);
      setCatalogueNotice(null);
    } catch (error) {
      setCatalogueNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogueLoading(false);
    }
  }, []);

  const openCatalogue = useCallback(() => {
    setCatalogueNotice(null);
    setRoute({ kind: "catalogue" });
    void refreshCatalogue();
  }, [refreshCatalogue]);

  const installFromCatalogue = useCallback(
    async (entry: CatalogueEntry) => {
      setCatalogueNotice(null);
      const result = await catalogue.install(entry.id, entry.version);
      if (!result.ok) {
        setCatalogueNotice(result.message);
        return;
      }
      await reloadPacks();
      await refreshCatalogue();
      const manifest = result.outcome.pack.manifest;
      const publisherId = manifest.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID;
      await consent?.recordInstall({
        pack: { publisherId, packId: manifest.id, version: manifest.version },
        capabilities: manifest.capabilities,
      });
      setConsentVersion((value) => value + 1);
      const verb =
        result.action === "install"
          ? "installed"
          : result.action === "update"
            ? "updated"
            : "reinstalled";
      setCatalogueNotice(`${entry.name} ${entry.version} ${verb}.`);
    },
    [consent, refreshCatalogue, reloadPacks],
  );

  const installFromFile = useCallback(async () => {
    setNotice(null);
    try {
      const picked = await files.pickOpen([{ name: "Suite pack", extensions: ["pack"] }]);
      if (!picked) return;
      const outcome = await packs.install(picked.bytes);
      if (!outcome.ok) {
        setNotice(outcome.message);
        return;
      }
      await reloadPacks();
      const manifest = outcome.pack.manifest;
      await consent?.recordInstall({
        pack: {
          publisherId: manifest.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID,
          packId: manifest.id,
          version: manifest.version,
        },
        capabilities: manifest.capabilities,
      });
      setConsentVersion((value) => value + 1);
      setNotice(`${manifest.name} ${manifest.version} installed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [consent, reloadPacks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Home's shadow shelf is the verified index, so it is fetched once at launch
  // rather than only when someone opens the catalogue. A failed fetch leaves the
  // shelf empty and the catalogue keeps its own refusal sentence.
  useEffect(() => {
    void refreshCatalogue();
  }, [refreshCatalogue]);

  // Installed packs from before the consent record existed get their install-tier
  // rows written once. These are the capabilities the manifest already declared,
  // so this records the standing install decision rather than inventing consent.
  useEffect(() => {
    if (consent === null || !loaded) return;
    let changed = false;
    void (async () => {
      for (const pack of installed) {
        const publisherId = pack.manifest.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID;
        const answers = consent.answersFor({ publisherId, packId: pack.manifest.id });
        if (answers.length > 0) continue;
        await consent.recordInstall({
          pack: { publisherId, packId: pack.manifest.id, version: pack.manifest.version },
          capabilities: pack.manifest.capabilities,
          at: pack.installedAt > 0 ? pack.installedAt : Date.now(),
        });
        changed = true;
      }
      if (changed) setConsentVersion((value) => value + 1);
    })();
  }, [consent, installed, loaded]);

  const modules = useMemo(() => {
    // Scratch is the reference module, not a shipping app. A release build has no
    // built-in domain; an installed pack is the only way in.
    const builtIn = import.meta.env.DEV ? [scratchModule] : [];
    const installedIds = new Set(installed.map((pack) => pack.manifest.id));
    return [
      // A built-in module yields to an installed pack with the same id: two
      // declarations of one app would be two tabs and two document roots.
      ...builtIn.filter((module) => !installedIds.has(module.id)),
      ...installed.map((pack) =>
        packAsModule(
          pack,
          () => setQuickCaptureOpen(true),
          (id) => exportDocumentRef.current(id),
          (capability) => askConsentRef.current(pack.manifest.id, capability),
        ),
      ),
    ];
  }, [installed]);

  const ordered = useMemo(() => orderModules(modules, pinned), [modules, pinned]);
  const captureTargets = ordered.filter((module) => module.capabilities.includes("capture"));
  const captureTarget = captureTargets[0];
  // Restore the strip once the installed packs are known, so a tab is not
  // dropped merely because a pack had not been discovered yet.
  useEffect(() => {
    if (!loaded || restored) return;
    let cancelled = false;
    void tabStore.read().then((saved) => {
      if (cancelled) return;
      const next = retainTabs(
        saved,
        ordered.map((module) => module.id),
      );
      setTabs(next);
      if (next.active !== null) setMounted([next.active]);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, restored, ordered]);

  useEffect(() => {
    if (!restored) return;
    void tabStore.write(tabs);
  }, [tabs, restored]);

  const activate = useCallback((moduleId: string) => {
    setTabs((state) => openTab(state, moduleId));
    setMounted((ids) => (ids.includes(moduleId) ? ids : [...ids, moduleId]));
    setRoute({ kind: "home" });
  }, []);

  const showHomeTab = useCallback(() => {
    setTabs((state) => showHome(state));
    setRoute({ kind: "home" });
  }, []);

  const flushModule = useCallback(async (moduleId: string) => {
    try {
      await flushes.current.get(moduleId)?.();
    } catch (error) {
      console.error(`Suite Go: ${moduleId} did not flush its document`, error);
    }
  }, []);

  const releaseModule = useCallback(
    async (moduleId: string) => {
      const timer = idleTimers.current.get(moduleId);
      if (timer !== undefined) {
        clearTimeout(timer);
        idleTimers.current.delete(moduleId);
      }
      await flushModule(moduleId);
      const cleanup = cleanups.current.get(moduleId);
      cleanups.current.delete(moduleId);
      flushes.current.delete(moduleId);
      await cleanup?.();
      setMounted((ids) => ids.filter((id) => id !== moduleId));
    },
    [flushModule],
  );

  const closeTabAction = useCallback(
    async (moduleId: string) => {
      const next = closeTab(tabs, moduleId);
      await releaseModule(moduleId);
      setTabs(next);
      const nextActive = next.active;
      if (nextActive !== null) {
        setMounted((ids) => (ids.includes(nextActive) ? ids : [...ids, nextActive]));
      }
    },
    [tabs, releaseModule],
  );

  const removePack = useCallback(
    async (moduleId: string) => {
      const closing = tabs.tabs.filter((id) => id === moduleId);
      for (const id of closing) await releaseModule(id);
      const next = removeTabs(tabs, closing);
      setTabs(next);
      await packs.uninstall(moduleId);
      await consent?.clearForPack(moduleId);
      setConsentVersion((value) => value + 1);
      await reloadPacks();
      setNotice("Removed. Its documents stay on this device.");
    },
    [consent, reloadPacks, releaseModule, tabs],
  );

  // Inactive tabs flush and unmount after a grace period; the tab remains and
  // remounts on switch. Returning before the timer clears it, so a scroll
  // position survives a quick trip to another app.
  useEffect(() => {
    for (const id of mounted) {
      if (id === tabs.active) {
        const timer = idleTimers.current.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          idleTimers.current.delete(id);
        }
        continue;
      }
      if (idleTimers.current.has(id)) continue;
      idleTimers.current.set(
        id,
        setTimeout(() => {
          idleTimers.current.delete(id);
          void releaseModule(id);
        }, IDLE_RELEASE_MS),
      );
    }
  }, [mounted, tabs.active, releaseModule]);

  useEffect(() => {
    const subscription = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) return;
      for (const id of mounted) void flushModule(id);
    });
    return () => {
      void subscription.then((handle) => handle.remove());
    };
  }, [mounted, flushModule]);

  // Android's back button belongs to the container: settings, then the
  // catalogue, then from a tab to Home, then out of the app.
  useEffect(() => {
    const subscription = NativeApp.addListener("backButton", () => {
      if (settingsOpen) setSettingsOpen(false);
      else if (route.kind === "catalogue") setRoute({ kind: "home" });
      else if (tabs.active !== null) showHomeTab();
      else void NativeApp.exitApp();
    });
    return () => {
      void subscription.then((handle) => handle.remove());
    };
  }, [settingsOpen, route.kind, tabs.active, showHomeTab]);

  const togglePin = useCallback((moduleId: string) => {
    setPinned((current) => {
      const next = current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [moduleId, ...current];
      void pins.set(next);
      return next;
    });
  }, []);

  const consentIdentity = useCallback(
    (moduleId: string): PackConsentIdentity => {
      const pack = installed.find((candidate) => candidate.manifest.id === moduleId);
      const module = ordered.find((candidate) => candidate.id === moduleId);
      return {
        publisherId: pack?.manifest.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID,
        packId: moduleId,
        version: pack?.manifest.version ?? "0.0.0",
        name: pack?.manifest.name ?? module?.name ?? moduleId,
      };
    },
    [installed, ordered],
  );

  const askConsent = useCallback(
    async (moduleId: string, capability: PackCapability): Promise<boolean> => {
      if (consent === null) return false;
      const identity = consentIdentity(moduleId);
      const reason = CAPABILITY_REASONS[capability] ?? capability;
      return consent.ensure(
        {
          publisherId: identity.publisherId,
          packId: identity.packId,
          version: identity.version,
          capability,
          reason,
        },
        () =>
          new Promise<boolean>((resolve) => {
            setPendingConsent({
              packName: identity.name,
              capability,
              reason,
              resolve,
            });
          }),
      );
    },
    [consent, consentIdentity],
  );

  useEffect(() => {
    askConsentRef.current = askConsent;
  }, [askConsent]);

  const reaskConsent = useCallback(
    async (app: SettingsApp, permission: ConsentView) => {
      if (consent === null) return;
      const identity = consentIdentity(app.id);
      await consent.forget({
        publisherId: identity.publisherId,
        packId: identity.packId,
        version: identity.version,
        capability: permission.capability,
        reason: permission.reason,
      });
      setConsentVersion((value) => value + 1);
      const granted = await consent.ensure(
        {
          publisherId: identity.publisherId,
          packId: identity.packId,
          version: identity.version,
          capability: permission.capability,
          reason: permission.reason,
        },
        () =>
          new Promise<boolean>((resolve) => {
            setPendingConsent({
              packName: app.name,
              capability: permission.capability,
              reason: permission.reason,
              resolve,
            });
          }),
      );
      setConsentVersion((value) => value + 1);
      if (!granted) setNotice(`${permission.capability} stays off for ${app.name}.`);
    },
    [consent, consentIdentity],
  );

  const hosts = useMemo(() => {
    const map = new Map<string, ModuleHost>();
    const host = (moduleId: string): ModuleHost => {
      const existing = map.get(moduleId);
      if (existing !== undefined) return existing;
      const pack = installed.find((candidate) => candidate.manifest.id === moduleId);
      const manifest = pack?.manifest;
      const identityInfo = {
        publisherId: manifest?.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID,
        packId: moduleId,
      };
      const declaredIdentity = manifest?.capabilities.includes("identity.pack") === true;
      const identity =
        declaredIdentity && deviceKey !== null
          ? createPackIdentity(deviceKey, identityInfo.publisherId, identityInfo.packId)
          : refusedPackIdentity(
              declaredIdentity
                ? `${manifest?.name ?? moduleId} declared "identity.pack", but this host has no usable device key.`
                : `${manifest?.name ?? moduleId} did not declare "identity.pack"; this host has no key for it.`,
            );
      const moduleFiles = createPackFiles(
        manifest === undefined ? { packId: moduleId } : packFilesScopeOf(manifest),
      );
      const next: ModuleHost = {
        moduleId,
        documents,
        storage: createKeyValueStore(moduleId),
        navigation: {
          setTitle: () => {
            // The frame shows the module's declared name. A module renaming itself is
            // not a v0 need, and accepting it would mean tracking state nothing reads.
          },
          close: showHomeTab,
        },
        files: moduleFiles,
        notifications,
        identity,
        recents: {
          remember: (documentId, title) => {
            void recents.remember({ documentId, moduleId, title }).then(refreshRecents);
          },
          forget: (documentId) => {
            void recents.forget(documentId);
          },
        },
        theme,
      };
      map.set(moduleId, next);
      return next;
    };
    for (const module of ordered) host(module.id);
    return map;
  }, [ordered, installed, theme, deviceKey, refreshRecents, showHomeTab]);

  const exportActiveDocument = useCallback(async (moduleId: string) => {
    try {
      const docs = await documents.list(moduleId);
      const firstDoc = docs[0];
      if (!firstDoc) {
        setNotice("No saved document found to export.");
        return;
      }
      const record = await documents.open(firstDoc.id);
      if (!record) {
        setNotice("Document could not be opened.");
        return;
      }
      const fileName = record.name.includes(".") ? record.name : `${record.name}.json`;
      const outcome = await files.share({
        name: fileName,
        mimeType: mimeFor(fileName),
        bytes: record.bytes,
      });
      if (!outcome.ok && outcome.reason !== "cancelled") {
        setNotice(`Export failed: ${outcome.message ?? "unknown error"}`);
      }
    } catch (error) {
      setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  useEffect(() => {
    exportDocumentRef.current = (moduleId) => void exportActiveDocument(moduleId);
  }, [exportActiveDocument]);

  // The intent is handed to the mounted module once. A tab already open keeps
  // its instance, so the intent is stored beside the route rather than remounting.
  const [captureDelivery, setCaptureDelivery] = useState<{
    readonly moduleId: string;
    readonly intent: CaptureIntent;
    readonly nonce: number;
  } | null>(null);
  const captureNonce = useRef(0);
  const setCaptureIntent = useCallback((intent: CaptureIntent, moduleId: string) => {
    captureNonce.current += 1;
    setCaptureDelivery({ moduleId, intent, nonce: captureNonce.current });
  }, []);

  // A capture is delivered once. Clearing it after the mounted module's effect
  // has run means a tab released by the grace timer and remounted later does not
  // replay the same text.
  useEffect(() => {
    if (captureDelivery === null) return;
    const timer = setTimeout(() => setCaptureDelivery(null), 0);
    return () => clearTimeout(timer);
  }, [captureDelivery]);

  const handleCapture = useCallback(
    (body: string, targetModuleId?: string) => {
      const targetId = targetModuleId || captureTarget?.id;
      if (!targetId) return;
      const intent: CaptureIntent = { kind: "text", body, source: "shell.capture" };
      // Opening a tab that is already open focuses it; the mount effect receives
      // the intent and delivers the capture without a second instance.
      activate(targetId);
      setCaptureIntent(intent, targetId);
    },
    [activate, captureTarget, setCaptureIntent],
  );

  const shelf = useMemo(() => shelfFrom(catalogueEntries), [catalogueEntries]);

  // Deliberately not memoised: `consentVersion` is the re-render signal after an
  // answer changes, and the record mutates in place.
  void consentVersion;
  const settingsApps: readonly SettingsApp[] = (() => {
    if (consent === null) return [];
    return installed.map((pack) => {
      const publisher = pack.manifest.publisher?.id ?? FIRST_PARTY_PUBLISHER_ID;
      return {
        id: pack.manifest.id,
        name: pack.manifest.name,
        version: pack.manifest.version,
        publisher,
        sizeBytes: pack.bytes,
        installedAt: pack.installedAt,
        permissions: consent.viewsFor({
          publisherId: publisher,
          packId: pack.manifest.id,
          version: pack.manifest.version,
        }),
      };
    });
  })();

  const renderHome = route.kind === "home" && tabs.active === null;

  return (
    <>
      {route.kind === "home" ? (
        <TabBar
          tabs={tabs.tabs.map((id) => ({
            id,
            name: ordered.find((module) => module.id === id)?.name ?? id,
          }))}
          activeId={tabs.active}
          onFocus={activate}
          onClose={(id) => void closeTabAction(id)}
          onHome={showHomeTab}
          onCatalogue={openCatalogue}
        />
      ) : null}

      {renderHome ? (
        <Home
          modules={ordered}
          pinned={pinned}
          recents={recent}
          shelf={shelf.shadows}
          onOpen={activate}
          onCapture={(body) => handleCapture(body)}
          onTogglePin={togglePin}
          onCatalogue={openCatalogue}
          onInstall={() => void installFromFile()}
          onInstallEntry={(entry) => void installFromCatalogue(entry)}
          onSettings={() => setSettingsOpen(true)}
          onRemove={(moduleId) => void removePack(moduleId)}
          removable={new Set(installed.map((pack) => pack.manifest.id))}
          notice={notice}
        />
      ) : null}

      {route.kind === "catalogue" ? (
        <Catalogue
          entries={catalogueEntries}
          notice={catalogueNotice}
          loading={catalogueLoading}
          onRefresh={() => void refreshCatalogue()}
          onInstall={(entry) => void installFromCatalogue(entry)}
          onRemove={(id) => void removePack(id)}
          onClose={() => setRoute({ kind: "home" })}
        />
      ) : null}

      {mounted.map((moduleId) => {
        const module = ordered.find((candidate) => candidate.id === moduleId);
        const host = hosts.get(moduleId);
        if (module === undefined || host === undefined) return null;
        const delivery =
          captureDelivery?.moduleId === moduleId ? captureDelivery.intent : undefined;
        const hidden = route.kind !== "home" || tabs.active !== moduleId;
        return (
          <div key={moduleId} className="module-host" hidden={hidden}>
            <MountedModule
              module={module}
              host={host}
              {...(delivery ? { intent: delivery } : {})}
              onClose={showHomeTab}
              onQuickCapture={() => setQuickCaptureOpen(true)}
              onExport={() => void exportActiveDocument(moduleId)}
              onCleanupReady={(cleanup) => {
                cleanups.current.set(moduleId, cleanup);
              }}
              onFlushReady={(flush) => {
                flushes.current.set(moduleId, flush);
              }}
            />
          </div>
        );
      })}

      <QuickCaptureSheet
        open={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        onCapture={handleCapture}
        targets={captureTargets.map((m) => ({ id: m.id, name: m.name }))}
        defaultTargetId={tabs.active ?? captureTarget?.id}
      />

      <SettingsSheet
        open={settingsOpen}
        choice={themeChoice}
        density={density}
        onChange={changeTheme}
        onDensityChange={changeDensity}
        apps={settingsApps}
        onRemoveApp={(id) => void removePack(id)}
        onReask={(app, permission) => void reaskConsent(app, permission)}
        onClose={() => setSettingsOpen(false)}
      />

      <ConsentSheet
        open={pendingConsent !== null}
        packName={pendingConsent?.packName ?? ""}
        capability={pendingConsent?.capability ?? null}
        reason={pendingConsent?.reason ?? ""}
        onAnswer={(granted) => {
          const pending = pendingConsent;
          setPendingConsent(null);
          pending?.resolve(granted);
          setConsentVersion((value) => value + 1);
        }}
      />
    </>
  );
}
