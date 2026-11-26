import {
  type ModuleHost,
  type PackCapability,
  type PackManifest,
  requestFrameFlush,
} from "@suite/go";
import { useEffect, useMemo, useRef } from "react";
import { createPackFiles, packFilesScopeOf, releasePackFileLocks } from "../host/packFiles.js";
import { resolveTheme } from "../host/theme.js";
import { serveFrame } from "./frameBridge.js";
import { ModuleHeader } from "./ModuleHeader.js";

/**
 * A pack that renders in its own document.
 *
 * The frame is same-origin on purpose. Packs are ours and audited, and a cross-origin frame
 * would buy a security boundary we do not need at the price of losing the `/_capacitor_file_/`
 * proxy that makes a pack's own assets resolve. What keeps a domain out of the shell is the
 * narrow message surface, not the browser.
 *
 * What this does buy: a separate document (so a pack's Tailwind preflight cannot restyle the
 * launcher), a separate JS realm (so two Reacts never meet), and a page life that ends when the
 * person leaves. What it does **not** buy is a separate process — an out-of-memory in the frame
 * still takes the shell down, which is why the measurement exists.
 */
export function IsolatedModule({
  host,
  entryUrl,
  title,
  manifest,
  consent,
  onQuickCapture,
  onExport,
  onFrameReady,
}: {
  readonly host: ModuleHost;
  readonly entryUrl: string;
  readonly title: string;
  readonly manifest: PackManifest;
  /** Ask at the capability's tier before a request moves data (S4.2). */
  readonly consent?: (capability: PackCapability) => Promise<boolean>;
  readonly onQuickCapture?: () => void;
  readonly onExport?: () => void;
  /**
   * Hands the container a way to ask the frame to write its pending document.
   *
   * An isolated pack owns its document, so the container cannot save it. What it can do is ask at
   * the boundaries a phone gives us and await the answer before removing the frame — which is why
   * this is a function and not a flag.
   */
  readonly onFrameReady?: (flush: () => Promise<void>) => void;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  /**
   * False until the frame has loaded its own document.
   *
   * A control posted before then reaches `about:blank`, where the pack's listener does not exist,
   * and the shell would wait out the timeout on a module the person closed immediately.
   */
  const loaded = useRef(false);
  /**
   * The pack's file store, built from the manifest this frame was mounted with.
   *
   * Deliberately not `host.files`: the sender is this frame, and its identity is
   * the manifest the shell installed. A request never names a root, and a
   * message cannot talk the bridge into another pack's store.
   */
  const files = useMemo(() => createPackFiles(packFilesScopeOf(manifest)), [manifest]);

  useEffect(() => {
    const stop = serveFrame({
      host,
      manifest: () => manifest,
      files,
      theme: () => {
        const tokens = resolveTheme();
        return { scheme: tokens.scheme, density: tokens.density, variables: tokens.cssVariables };
      },
      ...(consent === undefined ? {} : { consent }),
      target: () => frame.current?.contentWindow ?? null,
    });

    const flush = async () => {
      if (!loaded.current) return;
      const target = frame.current?.contentWindow;
      if (!target) return;
      await requestFrameFlush(target);
    };
    onFrameReady?.(flush);

    return () => {
      stop();
      // The frame is gone; anything it still held is stale.
      void releasePackFileLocks(packFilesScopeOf(manifest));
    };
  }, [host, manifest, files, onFrameReady, consent]);

  return (
    <div className="module">
      <ModuleHeader
        title={title}
        moduleName={manifest.name}
        onClose={() => host.navigation.close()}
        {...(onQuickCapture ? { onQuickCapture } : {})}
        {...(onExport ? { onExport } : {})}
      />
      <div className="module-body">
        {/*
          No sandbox attribute: a sandboxed frame without `allow-same-origin` cannot fetch the
          pack's own wasm through the file proxy, and one with it is not a boundary anyway. The
          contract, not the browser, is what limits a pack.
        */}
        <iframe
          ref={frame}
          src={entryUrl}
          title={title}
          className="h-full w-full border-0"
          data-suite-frame={host.moduleId}
          onLoad={() => {
            loaded.current = true;
          }}
        />
      </div>
    </div>
  );
}
